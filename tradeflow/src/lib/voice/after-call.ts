import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { runStructured } from '@/lib/ai/run';
import { aiConfigured, EFFORT } from '@/lib/ai/client';
import { todayInAustralia, addDays } from '@/lib/format';

/**
 * After-call intelligence.
 *
 * A phone call is a conversation. A business needs a record. This turns one
 * into the other: what the call was about, how the caller sounded, and the
 * specific things that were asked for, each with a deadline and a priority.
 *
 * The extraction is schema-constrained rather than parsed out of prose, and
 * nothing it produces is applied automatically. Proposals land in
 * `call_actions` for a person to confirm, because a mis-heard sentence should
 * never create work in someone's business on its own.
 */

interface Extraction {
  summary: string;
  intent: string;
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'angry';
  outcome: string;
  caller_name: string | null;
  actions: {
    kind: 'task' | 'note' | 'callback' | 'quote_request' | 'complaint' | 'booking';
    title: string;
    detail: string | null;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    /** A date if one was stated or clearly implied, else null. */
    due_date: string | null;
    /** The job number the caller was talking about, if they named one. */
    job_reference: string | null;
  }[];
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'intent', 'sentiment', 'outcome', 'caller_name', 'actions'],
  properties: {
    summary: {
      type: 'string',
      description:
        'One or two sentences, as the business owner would want to read it on their phone. ' +
        'Name the person and what they wanted. No preamble.',
    },
    intent: {
      type: 'string',
      description: 'A short label: "chasing progress", "reporting a defect", "new enquiry".',
    },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'frustrated', 'angry'] },
    outcome: {
      type: 'string',
      description: 'What was agreed or left open, in one sentence.',
    },
    caller_name: {
      type: ['string', 'null'],
      description: 'The caller\'s name if they gave one, else null.',
    },
    actions: {
      type: 'array',
      description:
        'Every distinct thing the business now has to do. Empty if the call needed nothing.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'detail', 'priority', 'due_date', 'job_reference'],
        properties: {
          kind: {
            type: 'string',
            enum: ['task', 'note', 'callback', 'quote_request', 'complaint', 'booking'],
          },
          title: {
            type: 'string',
            description: 'The action as an instruction: "Inspect crack near window at 15 King Street".',
          },
          detail: { type: ['string', 'null'], description: 'What the caller actually said.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          due_date: {
            type: ['string', 'null'],
            description:
              'YYYY-MM-DD if a deadline was stated or implied ("before Friday"), else null. ' +
              'Resolve relative dates against the call date given in the prompt.',
          },
          job_reference: {
            type: ['string', 'null'],
            description: 'A job number like JOB-0042 if one was mentioned, else null.',
          },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  'You convert a phone call transcript into a structured record for a trade business.',
  '',
  'Rules:',
  '- Record only what was actually said. Do not infer work nobody asked for.',
  '- "Before Friday" is a deadline. "Sometime" is not — leave due_date null.',
  '- Urgency comes from what was said, not from tone alone: a leak, a safety issue or a ' +
    'stated deadline is urgent or high; a general enquiry is low or medium.',
  '- A caller who mentions chasing something up, or says they have called before, is at ' +
    'least "frustrated".',
  '- If the caller only wanted information and got it, the actions array is empty.',
  '- Write the summary the way a foreman would: plain, specific, no filler.',
].join('\n');

export interface AfterCallResult {
  summary: string | null;
  actionCount: number;
  error: string | null;
}

/**
 * Run the extraction and store it. Called when a call ends — from the
 * telephony provider's status webhook, or when the test console hangs up.
 */
export async function processEndedCall(
  businessId: string,
  callId: string
): Promise<AfterCallResult> {
  const admin = createAdminClient();

  const { data: call } = await admin
    .from('calls')
    .select('*')
    .eq('id', callId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (!call) return { summary: null, actionCount: 0, error: 'call not found' };

  const { data: turns } = await admin
    .from('call_turns')
    .select('role, text, position')
    .eq('call_id', callId)
    .order('position');

  const transcript = (turns ?? [])
    .map((turn) => `${turn.role === 'caller' ? 'Caller' : 'Assistant'}: ${turn.text}`)
    .join('\n');

  const durationSeconds = call.ended_at
    ? Math.max(
        Math.round((Date.parse(call.ended_at) - Date.parse(call.started_at)) / 1000),
        0
      )
    : Math.max(Math.round((Date.now() - Date.parse(call.started_at)) / 1000), 0);

  // Close the call record whatever happens next, so a failed extraction never
  // leaves a call stuck "in progress".
  await admin
    .from('calls')
    .update({
      status: 'completed',
      ended_at: call.ended_at ?? new Date().toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', callId);

  // A call with nothing said in it needs no extraction.
  if (!turns || turns.filter((turn) => turn.role === 'caller').length === 0) {
    await admin
      .from('calls')
      .update({ summary: 'The caller hung up without saying anything.', outcome: 'No conversation' })
      .eq('id', callId);
    return { summary: 'The caller hung up without saying anything.', actionCount: 0, error: null };
  }

  if (!aiConfigured()) {
    const fallback = firstCallerLine(turns);
    await admin
      .from('calls')
      .update({
        summary: fallback,
        outcome: 'Recorded without AI extraction (no ANTHROPIC_API_KEY).',
      })
      .eq('id', callId);
    return { summary: fallback, actionCount: 0, error: 'ai not configured' };
  }

  const today = todayInAustralia();

  let extraction: Extraction | null = null;
  try {
    extraction = await runStructured<Extraction>({
      system: SYSTEM,
      prompt: [
        `Call date: ${today}. Resolve relative deadlines against this date.`,
        `This week ends ${addDays(today, 7 - (new Date(`${today}T00:00:00Z`).getUTCDay() || 7))}.`,
        call.from_number ? `Caller number: ${call.from_number}` : 'Caller number withheld.',
        call.caller_name ? `Known customer: ${call.caller_name}` : 'Caller not matched to a customer.',
        '',
        'Transcript:',
        transcript,
      ].join('\n'),
      schema: SCHEMA as unknown as Record<string, unknown>,
      effort: EFFORT.assistant,
      maxTokens: 2000,
    });
  } catch {
    extraction = null;
  }

  if (!extraction) {
    const fallback = firstCallerLine(turns);
    await admin
      .from('calls')
      .update({ summary: fallback, outcome: 'The call could not be summarised automatically.' })
      .eq('id', callId);
    return { summary: fallback, actionCount: 0, error: 'extraction failed' };
  }

  // Resolve any job number the caller named to a real job.
  const references = [
    ...new Set(
      extraction.actions
        .map((action) => action.job_reference)
        .filter((reference): reference is string => Boolean(reference))
    ),
  ];
  const jobIds = new Map<string, string>();
  if (references.length > 0) {
    const { data: jobs } = await admin
      .from('jobs')
      .select('id, number')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .in('number', references);
    for (const job of jobs ?? []) jobIds.set(job.number, job.id);
  }

  await admin
    .from('calls')
    .update({
      summary: extraction.summary,
      intent: extraction.intent,
      sentiment: extraction.sentiment,
      outcome: extraction.outcome,
      caller_name: call.caller_name ?? extraction.caller_name,
    })
    .eq('id', callId);

  // Anything the agent already proposed mid-call is in call_actions. Add only
  // what the extraction found on top of it, matched loosely by title so the
  // same request does not appear twice.
  const { data: existing } = await admin
    .from('call_actions')
    .select('title')
    .eq('call_id', callId);

  const seen = new Set((existing ?? []).map((row) => normalise(row.title)));
  const fresh = extraction.actions.filter((action) => !seen.has(normalise(action.title)));

  if (fresh.length > 0) {
    await admin.from('call_actions').insert(
      fresh.map((action) => ({
        business_id: businessId,
        call_id: callId,
        kind: action.kind,
        title: action.title.slice(0, 300),
        detail: action.detail,
        priority: action.priority,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(action.due_date ?? '') ? action.due_date : null,
        suggested_customer_id: call.customer_id,
        suggested_job_id: action.job_reference ? (jobIds.get(action.job_reference) ?? null) : null,
      }))
    );
  }

  // The people who need to know: an angry caller or an escalation should not
  // wait for someone to open the call log.
  const urgent =
    call.escalated ||
    extraction.sentiment === 'angry' ||
    extraction.actions.some((action) => action.priority === 'urgent');

  const { data: recipients } = await admin
    .from('team_members')
    .select('user_id')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .not('user_id', 'is', null)
    .in('role', ['owner', 'admin', 'manager']);

  if (recipients?.length) {
    await admin.from('notifications').insert(
      recipients.map((recipient) => ({
        business_id: businessId,
        user_id: recipient.user_id,
        kind: 'call_received',
        title: `${call.caller_name ?? extraction.caller_name ?? 'Someone'} called${
          urgent ? ' — needs attention' : ''
        }`,
        body: extraction.summary,
        link: `/calls/${callId}`,
        severity: urgent ? 'warning' : 'info',
      }))
    );
  }

  const total = (existing?.length ?? 0) + fresh.length;
  return { summary: extraction.summary, actionCount: total, error: null };
}

function firstCallerLine(turns: { role: string; text: string }[]): string {
  const line = turns.find((turn) => turn.role === 'caller')?.text ?? '';
  return line ? `Caller said: ${line.slice(0, 200)}` : 'A call was received.';
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
