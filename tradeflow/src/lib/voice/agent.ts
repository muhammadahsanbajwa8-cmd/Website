import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { brainSystemPrompt, callerContextPrompt, loadBrain, type LoadedBrain } from '@/lib/ai/brain';
import { runAgent } from '@/lib/ai/run';
import { aiConfigured, describeAiError, EFFORT } from '@/lib/ai/client';
import { AU_TIMEZONE } from '@/lib/format';
import type { Json } from '@/lib/database.types';

/**
 * The phone agent.
 *
 * A call is a sequence of turns. Each turn gets the caller's words, the whole
 * conversation so far, and the business brain — and produces one short spoken
 * reply plus, sometimes, a proposal for something the business should do.
 *
 * Three things this module is careful about:
 *
 * **Memory within the call.** The full message history is rebuilt from
 * `call_turns` on every turn, so "the house in Baldivis" three turns ago is
 * still in context when the caller says "the supervisor said Tuesday". The
 * agent never asks a caller to repeat something they already said.
 *
 * **Identity before the first word.** The caller's number is matched against
 * customers before the greeting is composed, so a known customer is greeted by
 * name and their open jobs are already in the prompt — no account numbers, no
 * "which job are you calling about".
 *
 * **Nothing is committed mid-call.** Tasks are *proposed* during the call and
 * written to `call_actions` for a person to confirm. A speech-recognition
 * error should not silently create work in someone's business.
 */

export interface CallerIdentity {
  customer_id: string;
  name: string;
  company: string | null;
  jobs: {
    id: string;
    number: string;
    name: string;
    status: string;
    site: string | null;
    expected_completion: string | null;
  }[];
}

export interface StartedCall {
  callId: string;
  greeting: string;
  identity: CallerIdentity | null;
  afterHours: boolean;
  brain: LoadedBrain;
}

/** Local time in the business's timezone, as a person would say it. */
function localTime(): { text: string; hour: number; weekday: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: AU_TIMEZONE,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(
    new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hour12: false, timeZone: AU_TIMEZONE }).format(now)
  );
  const weekdayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    .indexOf(get('weekday'));

  return {
    text: `${get('weekday')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`,
    hour,
    weekday: weekdayIndex,
  };
}

/**
 * Outside business hours? Read from the brain's own hours where they are set,
 * and fall back to a 7-to-5 weekday assumption, which is what a trade business
 * actually runs.
 */
function isAfterHours(brain: LoadedBrain, now: { hour: number; weekday: number }): boolean {
  const hours = brain.brain.business_hours;
  if (hours && typeof hours === 'object' && !Array.isArray(hours)) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = (hours as Record<string, unknown>)[names[now.weekday] ?? ''];
    if (typeof today === 'string') {
      if (/closed/i.test(today)) return true;
      const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(today);
      if (match) {
        const to24 = (h: string, meridiem?: string) => {
          let value = Number(h);
          if (meridiem?.toLowerCase() === 'pm' && value < 12) value += 12;
          if (meridiem?.toLowerCase() === 'am' && value === 12) value = 0;
          return value;
        };
        const open = to24(match[1]!, match[3]);
        const close = to24(match[4]!, match[6] ?? match[3]);
        return now.hour < open || now.hour >= close;
      }
    }
  }
  if (now.weekday === 0 || now.weekday === 6) return true;
  return now.hour < 7 || now.hour >= 17;
}

/**
 * Answer the phone: identify the caller, open the call record, and compose the
 * greeting. The AI disclosure is appended here rather than left to the model,
 * so it cannot be prompted away.
 */
export async function startCall(input: {
  businessId: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  provider?: string;
  providerCallSid?: string | null;
}): Promise<StartedCall | null> {
  const brain = await loadBrain(input.businessId);
  if (!brain) return null;

  const admin = createAdminClient();
  const now = localTime();
  const afterHours = isAfterHours(brain, now);

  const { data: identityData } = input.fromNumber
    ? await admin.rpc('ai_identify_caller', {
        target: input.businessId,
        p_number: input.fromNumber,
      })
    : { data: null };

  const identity = (identityData ?? null) as CallerIdentity | null;

  const { data: call } = await admin
    .from('calls')
    .insert({
      business_id: input.businessId,
      direction: 'inbound',
      status: 'in_progress',
      provider: input.provider ?? 'console',
      provider_call_sid: input.providerCallSid ?? null,
      from_number: input.fromNumber ?? null,
      to_number: input.toNumber ?? null,
      customer_id: identity?.customer_id ?? null,
      caller_name: identity?.name ?? null,
      after_hours: afterHours,
    })
    .select('id')
    .single();

  if (!call) return null;

  // The greeting is composed, not generated: it is the same every time, it
  // must contain the disclosure, and it must not cost a model round trip
  // before the caller hears anything.
  const base =
    (afterHours ? brain.brain.after_hours_greeting : brain.brain.greeting) ??
    `Hi, you've reached ${brain.businessName}.`;

  const disclosure = brain.brain.disclose_ai ? " I'm the company's AI assistant." : '';
  const byName = identity?.name ? ` Hi ${identity.name.split(' ')[0]},` : '';
  const outside = afterHours && !brain.brain.after_hours_greeting
    ? " We're outside our usual hours, but I can take the details and get them to the team."
    : '';

  const greeting = `${base}${disclosure}${byName ? `${byName} how can I help?` : ' How can I help?'}${outside}`
    .replace(/\s+/g, ' ')
    .trim();

  await admin.from('call_turns').insert({
    business_id: input.businessId,
    call_id: call.id,
    role: 'agent',
    text: greeting,
    position: 0,
  });

  return { callId: call.id, greeting, identity, afterHours, brain };
}

export interface TurnResult {
  reply: string;
  escalated: boolean;
  escalationReason: string | null;
  /** True once the agent has what it needs and the call can be wound up. */
  shouldEndCall: boolean;
  latencyMs: number;
  error: string | null;
}

/**
 * One turn: what the caller said in, one short spoken reply out.
 *
 * `interrupted` records that the caller talked over the agent's previous
 * reply. It is stored on the turn so the transcript shows what actually
 * reached the caller's ear, and so a business reviewing its calls can see
 * where the agent was being too wordy.
 */
export async function handleTurn(input: {
  callId: string;
  businessId: string;
  said: string;
  confidence?: number | null;
  interrupted?: boolean;
}): Promise<TurnResult> {
  const started = Date.now();
  const admin = createAdminClient();

  const { data: call } = await admin
    .from('calls')
    .select('*')
    .eq('id', input.callId)
    .eq('business_id', input.businessId)
    .maybeSingle();

  if (!call) {
    return {
      reply: 'Sorry, something went wrong on my end. Let me get someone to call you back.',
      escalated: true,
      escalationReason: 'The call record could not be read.',
      shouldEndCall: true,
      latencyMs: Date.now() - started,
      error: 'call not found',
    };
  }

  const { data: priorTurns } = await admin
    .from('call_turns')
    .select('role, text, position')
    .eq('call_id', input.callId)
    .order('position');

  const nextPosition = (priorTurns?.length ?? 0);

  await admin.from('call_turns').insert({
    business_id: input.businessId,
    call_id: input.callId,
    role: 'caller',
    text: input.said,
    confidence: input.confidence ?? null,
    interrupted: input.interrupted ?? false,
    position: nextPosition,
  });

  if (!aiConfigured()) {
    const reply =
      "I'm not able to look anything up at the moment, but I can take your details and " +
      'get someone to call you back.';
    await recordAgentTurn(admin, input, reply, nextPosition + 1, Date.now() - started);
    return {
      reply,
      escalated: true,
      escalationReason: 'The AI assistant is not configured (no ANTHROPIC_API_KEY).',
      shouldEndCall: false,
      latencyMs: Date.now() - started,
      error: 'ai not configured',
    };
  }

  const brain = await loadBrain(input.businessId);
  if (!brain) {
    const reply = 'Let me get someone to call you straight back.';
    await recordAgentTurn(admin, input, reply, nextPosition + 1, Date.now() - started);
    return {
      reply,
      escalated: true,
      escalationReason: 'The business brain could not be loaded.',
      shouldEndCall: true,
      latencyMs: Date.now() - started,
      error: 'brain not found',
    };
  }

  // Everything said so far, so nothing has to be repeated by the caller.
  const history: Anthropic.MessageParam[] = (priorTurns ?? [])
    .filter((turn) => turn.role !== 'system')
    .map((turn) => ({
      role: turn.role === 'caller' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    }));
  history.push({ role: 'user', content: input.said });

  const identity = call.customer_id
    ? ((
        await admin.rpc('ai_identify_caller', {
          target: input.businessId,
          p_number: call.from_number ?? '',
        })
      ).data as CallerIdentity | null)
    : null;

  const volatile = [
    callerContextPrompt({
      callerNumber: call.from_number,
      customerName: identity?.name ?? call.caller_name,
      customerCompany: identity?.company ?? null,
      jobs: identity?.jobs.map((job) => ({
        number: job.number,
        name: job.name,
        status: job.status,
        site: job.site,
      })),
      afterHours: call.after_hours,
      localTime: localTime().text,
    }),
    input.confidence != null && input.confidence < 0.6
      ? '\nThe speech recognition was not confident about that line. If it does not make sense, ' +
        'ask about the single detail you are unsure of rather than asking them to repeat everything.'
      : '',
    input.interrupted
      ? '\nThe caller cut you off mid-sentence. Answer what they just asked and drop whatever ' +
        'you were saying. Keep this reply shorter.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await runAgent({
      systemStable: brainSystemPrompt(brain, 'phone'),
      systemVolatile: volatile,
      messages: history,
      surface: 'phone',
      businessId: input.businessId,
      customerId: call.customer_id,
      effort: EFFORT.voice,
      maxTokens: 300,
      maxToolRounds: 3,
    });

    const reply =
      result.text ||
      "Sorry, I didn't catch that — could you say it once more?";
    const latencyMs = Date.now() - started;

    await recordAgentTurn(admin, input, reply, nextPosition + 1, latencyMs);

    // Proposals are written now rather than after the call, so a dropped line
    // does not lose what the caller asked for.
    if (result.proposals.length > 0) {
      await admin.from('call_actions').insert(
        result.proposals.map((proposal) => ({
          business_id: input.businessId,
          call_id: input.callId,
          kind: 'task' as const,
          title: proposal.title.slice(0, 300),
          detail: proposal.detail ?? null,
          priority: (proposal.priority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
          due_date: proposal.due ?? null,
          suggested_customer_id: call.customer_id,
        }))
      );
    }

    if (result.escalation) {
      await admin
        .from('calls')
        .update({
          escalated: true,
          escalation_reason: result.escalation.reason,
        })
        .eq('id', input.callId);
    }

    return {
      reply,
      escalated: Boolean(result.escalation),
      escalationReason: result.escalation?.reason ?? null,
      // Wound up when the agent has said goodbye in some form.
      shouldEndCall: /\b(bye|goodbye|thanks for calling|have a good|speak soon)\b/i.test(reply),
      latencyMs,
      error: null,
    };
  } catch (error) {
    const reply =
      "I'm having trouble on my end — let me take your number and have someone call you back.";
    const latencyMs = Date.now() - started;
    await recordAgentTurn(admin, input, reply, nextPosition + 1, latencyMs);
    await admin
      .from('calls')
      .update({ escalated: true, escalation_reason: describeAiError(error) })
      .eq('id', input.callId);

    return {
      reply,
      escalated: true,
      escalationReason: describeAiError(error),
      shouldEndCall: false,
      latencyMs,
      error: describeAiError(error),
    };
  }
}

async function recordAgentTurn(
  admin: ReturnType<typeof createAdminClient>,
  input: { callId: string; businessId: string },
  text: string,
  position: number,
  latencyMs: number
): Promise<void> {
  await admin.from('call_turns').insert({
    business_id: input.businessId,
    call_id: input.callId,
    role: 'agent',
    text,
    position,
    latency_ms: latencyMs,
  });
}

export type { Json };
