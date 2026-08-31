import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { formatMoney } from '@/lib/format';
import type { Json } from '@/lib/database.types';

/**
 * The AI Business Brain.
 *
 * This module turns a business's own configuration into the system prompt its
 * assistant runs on. Three layers stack:
 *
 *   1. the industry profile — the vocabulary of the trade, so "the DPC above
 *      the base course" is understood rather than transcribed and ignored;
 *   2. the business row — services, hours, staff, area, tone, and the two
 *      lists that bound what it may say;
 *   3. FAQs and knowledge notes the business wrote itself.
 *
 * Two design decisions are worth stating.
 *
 * The prompt is assembled deterministically — same business, same bytes — so
 * it can carry a cache breakpoint. The stable half is the brain; the volatile
 * half (who is calling, what they just said) goes after it, and is never
 * interpolated into the cached prefix.
 *
 * And the brain is loaded with the service role. A phone call has no user
 * session: the caller is a stranger on a PSTN line, not someone with a JWT.
 * The business is established by which number was dialled, and every tool the
 * agent can reach is bound to that business id — so the absence of a session
 * never widens what the agent can see.
 */

export interface BrainRow {
  business_id: string;
  industry_key: string | null;
  tone: string;
  voice_name: string;
  speaking_rate: number;
  language: string;
  greeting: string | null;
  after_hours_greeting: string | null;
  voicemail_greeting: string | null;
  services: string[];
  service_area: string | null;
  business_hours: Json;
  emergency_hours: string | null;
  staff: Json;
  escalation_name: string | null;
  escalation_phone: string | null;
  escalation_email: string | null;
  allowed_topics: string[];
  forbidden_topics: string[];
  policies: string | null;
  pricing_guidance: string | null;
  disclose_ai: boolean;
  may_discuss_pricing: boolean;
  may_confirm_bookings: boolean;
  may_share_job_status: boolean;
  max_call_minutes: number;
  enabled: boolean;
  phone_number: string | null;
}

export interface IndustryProfile {
  key: string;
  name: string;
  terminology: string[];
  common_services: string[];
  common_questions: string[];
}

export interface LoadedBrain {
  businessId: string;
  businessName: string;
  brain: BrainRow;
  industry: IndustryProfile | null;
  faqs: { question: string; answer: string }[];
  knowledge: { title: string; body: string; category: string }[];
  teamNames: string[];
}

const TONE_GUIDANCE: Record<string, string> = {
  professional:
    'Businesslike and courteous. Complete sentences, no slang, but not stiff.',
  friendly:
    'Warm and easy. Short sentences, the odd "no worries", the way a good receptionist actually talks.',
  casual: 'Relaxed and plain-spoken. Contractions, short answers, no formality for its own sake.',
  warm: 'Unhurried and reassuring. Acknowledge what the person said before answering it.',
  concise: 'Brief. Answer in one sentence where one will do, and stop.',
  formal: 'Correct and precise. Full forms, no contractions, no colloquialism.',
};

export async function loadBrain(businessId: string): Promise<LoadedBrain | null> {
  const admin = createAdminClient();

  const { data: business } = await admin
    .from('businesses')
    .select('id, name, business_type')
    .eq('id', businessId)
    .maybeSingle();
  if (!business) return null;

  const [{ data: brain }, { data: faqs }, { data: knowledge }, { data: team }] =
    await Promise.all([
      admin.from('ai_brain').select('*').eq('business_id', businessId).maybeSingle(),
      admin
        .from('ai_faqs')
        .select('question, answer')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .order('position')
        .limit(60),
      admin
        .from('ai_knowledge')
        .select('title, body, category')
        .eq('business_id', businessId)
        .eq('approved', true)
        .is('deleted_at', null)
        .order('created_at')
        .limit(40),
      admin
        .from('team_members')
        .select('full_name, role')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .limit(40),
    ]);

  if (!brain) return null;
  const row = brain as unknown as BrainRow;

  const industryKey = row.industry_key ?? 'other';
  const { data: industry } = await admin
    .from('industry_profiles')
    .select('key, name, terminology, common_services, common_questions')
    .eq('key', industryKey)
    .or(`business_id.is.null,business_id.eq.${businessId}`)
    .limit(1)
    .maybeSingle();

  return {
    businessId,
    businessName: business.name,
    brain: row,
    industry: (industry as IndustryProfile | null) ?? null,
    faqs: faqs ?? [],
    knowledge: knowledge ?? [],
    teamNames: (team ?? [])
      .map((member) => (member.full_name ? `${member.full_name} (${member.role})` : null))
      .filter((name): name is string => name !== null),
  };
}

function staffLines(staff: Json): string[] {
  if (!Array.isArray(staff)) return [];
  return staff
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : null;
      if (!name) return null;
      const role = typeof record.role === 'string' ? record.role : null;
      const note = typeof record.note === 'string' ? record.note : null;
      return [name, role, note].filter(Boolean).join(' — ');
    })
    .filter((line): line is string => line !== null);
}

function hoursLines(hours: Json): string[] {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return [];
  return Object.entries(hours as Record<string, unknown>)
    .map(([day, value]) => (typeof value === 'string' ? `${day}: ${value}` : null))
    .filter((line): line is string => line !== null);
}

/**
 * The stable half of the system prompt. Deterministic for a given business, so
 * it can carry a cache_control breakpoint and be read back at a tenth of the
 * cost on the second and every later turn of a call.
 */
export function brainSystemPrompt(loaded: LoadedBrain, surface: 'phone' | 'assistant' | 'email'): string {
  const { brain, industry } = loaded;
  const sections: string[] = [];

  sections.push(
    `You are the assistant for ${loaded.businessName}, ` +
      `${industry ? `a business in ${industry.name.toLowerCase()}` : 'a trade business'} in Australia. ` +
      `You are not a general-purpose assistant: you work for this business and only this business.`
  );

  // --- how to sound --------------------------------------------------------
  sections.push(
    [
      '## How you speak',
      TONE_GUIDANCE[brain.tone] ?? TONE_GUIDANCE.friendly,
      '',
      'Rules that hold on every reply:',
      '- Keep it short. One or two sentences unless more was actually asked for.',
      '- Sound like a person, not a form. Never read a checklist of questions at someone.',
      '- Use ordinary acknowledgements — "yep, got it", "sure", "let me check that" — but vary them. Do not open every reply the same way.',
      '- Never say "I have successfully located the relevant record in our database". Say "yep, I\'ve got the job here".',
      '- Do not restate what the person just told you back at them before answering.',
      '- Australian English: "mobile" not "cell", dates as day/month, dollars as AUD. Do not perform Australian slang.',
    ].join('\n')
  );

  // --- what the business does ---------------------------------------------
  const facts: string[] = ['## The business'];
  facts.push(`Name: ${loaded.businessName}`);
  if (brain.services.length) facts.push(`Services: ${brain.services.join(', ')}`);
  else if (industry?.common_services.length) {
    facts.push(`Services: ${industry.common_services.join(', ')}`);
  }
  if (brain.service_area) facts.push(`Service area: ${brain.service_area}`);

  const hours = hoursLines(brain.business_hours);
  if (hours.length) facts.push(`Hours:\n${hours.map((line) => `  ${line}`).join('\n')}`);
  if (brain.emergency_hours) facts.push(`After hours: ${brain.emergency_hours}`);

  const staff = staffLines(brain.staff);
  if (staff.length) facts.push(`People:\n${staff.map((line) => `  ${line}`).join('\n')}`);
  else if (loaded.teamNames.length) facts.push(`People: ${loaded.teamNames.join(', ')}`);

  if (brain.escalation_name) {
    facts.push(`Escalate to: ${brain.escalation_name}${brain.escalation_phone ? ` (${brain.escalation_phone})` : ''}`);
  }
  sections.push(facts.join('\n'));

  // --- the trade's vocabulary ---------------------------------------------
  if (industry && industry.terminology.length) {
    sections.push(
      [
        '## Trade vocabulary',
        `These are ordinary words in this trade. Understand them when a caller uses them, and use them back naturally rather than translating into plain English:`,
        industry.terminology.join(', '),
      ].join('\n')
    );
  }

  // --- the rules -----------------------------------------------------------
  const rules: string[] = ['## What you may and may not do'];

  rules.push(
    brain.may_share_job_status
      ? '- You may tell an identified customer the status of their own job, and what is scheduled.'
      : '- Do not discuss job status. Take a message instead.'
  );
  rules.push(
    brain.may_discuss_pricing
      ? `- You may discuss pricing at the level below, and must say it is indicative and subject to a written quote.${brain.pricing_guidance ? `\n  ${brain.pricing_guidance}` : ''}`
      : '- Do not quote prices or estimate costs, even approximately. Say that a quote has to come from the team and take their details.'
  );
  rules.push(
    brain.may_confirm_bookings
      ? '- You may confirm a booking in an available slot, and must repeat the date and time back before ending the call.'
      : '- Do not confirm bookings or commit to a date. Say someone will call back to lock in a time.'
  );

  if (brain.allowed_topics.length) {
    rules.push(`- Topics you may discuss: ${brain.allowed_topics.join(', ')}.`);
  }
  if (brain.forbidden_topics.length) {
    rules.push(
      `- Never discuss, under any framing: ${brain.forbidden_topics.join(', ')}. ` +
        'If pressed, say it is not something you can help with and offer to pass it on.'
    );
  }

  rules.push(
    '- Never invent a fact about this business. If you do not know, say so and offer to find out.',
    '- Never give legal, tax or accounting advice.',
    '- Never promise a time, a price or an outcome you have not been given.',
    '- Never disclose another customer\'s details, another job, or anything about the business\'s finances.',
    '- If a caller cannot be identified, do not read out any record. Take their details instead.'
  );

  if (brain.policies?.trim()) {
    rules.push(`\nHouse rules, in the business's own words:\n${brain.policies.trim()}`);
  }
  sections.push(rules.join('\n'));

  // --- surface-specific behaviour -----------------------------------------
  if (surface === 'phone') {
    sections.push(
      [
        '## You are on a phone call',
        'Everything you say is read aloud by a synthetic voice to someone holding a phone, often on a noisy site.',
        '',
        '- Answer in ONE or TWO short sentences. Long replies get talked over.',
        '- No lists, no headings, no markdown, no emoji, no URLs, no email addresses spelled out letter by letter unless asked.',
        '- Numbers as a person says them: "fourteen Wattle Street", "about two and a half thousand dollars".',
        '- Ask ONE question at a time. Never ask for name, number, address and job in one breath.',
        '- Use what you already know. If they gave you the address, do not ask which job.',
        '- If speech came through garbled, ask about the ONE thing you missed: "sorry, was that fifteen King Street?" Never ask them to start again.',
        '- If they sound frustrated, acknowledge it once, plainly, and move to fixing it. Do not apologise repeatedly, do not blame anyone on the team, do not argue.',
        '- If they ask for a person, or the matter is beyond you, say you will get it to the right person and take the details. Use the escalate tool.',
        '- When you have what you need, say so and close. Do not keep the call going.',
      ].join('\n')
    );

    if (brain.disclose_ai) {
      sections.push(
        '## Disclosure\n' +
          'You are an AI assistant and must not claim to be a human. If asked directly whether ' +
          'you are a person or a machine, answer plainly that you are the business\'s AI assistant, ' +
          'then carry on with what they needed. Do not repeat the disclosure unprompted.'
      );
    }
  } else if (surface === 'assistant') {
    sections.push(
      [
        '## You are answering the business owner or their staff',
        '- They can see everything in their own business, so you may quote figures, job names and customer names freely.',
        '- Answer from the tools, not from memory. If a tool returns nothing, say nothing was found rather than guessing.',
        '- Amounts in AUD. Say whether a figure includes GST when it matters.',
        '- Be brief and concrete. A number and a sentence beats a paragraph.',
        '- You may not give legal, tax or accounting advice; state the figures and leave the advice to their accountant.',
      ].join('\n')
    );
  } else {
    sections.push(
      [
        '## You are helping with email',
        '- Write as the business, in the tone above, ready to send.',
        '- Never send anything. Everything you produce is a draft the person reviews and sends themselves.',
        '- Keep drafts to the length the message needs. No filler openings or closings.',
      ].join('\n')
    );
  }

  // --- the business's own answers -----------------------------------------
  if (loaded.faqs.length) {
    sections.push(
      [
        '## Answers this business has approved',
        'Use these words when the question comes up. They are the business\'s own answers.',
        ...loaded.faqs.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`),
      ].join('\n\n')
    );
  }

  if (loaded.knowledge.length) {
    sections.push(
      [
        '## Business knowledge',
        ...loaded.knowledge.map((note) => `### ${note.title} (${note.category})\n${note.body}`),
      ].join('\n\n')
    );
  }

  if (industry?.common_questions.length) {
    sections.push(
      '## Questions this trade gets asked\n' +
        industry.common_questions.map((question) => `- ${question}`).join('\n') +
        '\nIf one of these comes up and the business has not given you an answer above, say you will ' +
        'find out rather than guessing.'
    );
  }

  return sections.join('\n\n');
}

/**
 * The volatile half: who is calling and what is already known about them. Kept
 * out of the cached prefix on purpose.
 */
export function callerContextPrompt(context: {
  callerName?: string | null;
  callerNumber?: string | null;
  customerName?: string | null;
  customerCompany?: string | null;
  jobs?: { number: string; name: string; status: string; site?: string | null }[];
  afterHours?: boolean;
  localTime?: string;
}): string {
  const lines: string[] = ['## This call'];

  if (context.localTime) lines.push(`Local time: ${context.localTime}.`);
  if (context.afterHours) lines.push('This call is outside business hours.');

  if (context.customerName) {
    lines.push(
      `The caller's number matches an existing customer: ${context.customerName}` +
        `${context.customerCompany ? ` at ${context.customerCompany}` : ''}. ` +
        'Greet them by first name. Do not ask them to identify themselves or read out an account number.'
    );
  } else if (context.callerNumber) {
    lines.push(
      `Calling from ${context.callerNumber}, which does not match a customer on file. ` +
        'Ask for their name early, once, and use it.'
    );
  } else {
    lines.push('The caller could not be identified. Ask for their name once.');
  }

  if (context.jobs?.length) {
    lines.push(
      '',
      'Their open jobs — if they refer to "the job", "the kitchen", a street name or a suburb, ' +
        'this is almost certainly which one they mean. Do not ask them to specify unless two of ' +
        'these genuinely fit:',
      ...context.jobs.map(
        (job) =>
          `- ${job.number}: ${job.name}${job.site ? ` at ${job.site}` : ''} — currently ${job.status.replace(/_/g, ' ')}`
      )
    );
  }

  return lines.join('\n');
}

/** Human-readable money for a spoken reply. */
export function spokenMoney(cents: number): string {
  return formatMoney(cents).replace(/\.00$/, '');
}
