import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forSpeech, gather, sayAndHangUp, dial, verifyTwilioSignature } from '@/lib/voice/twiml';
import { brainSystemPrompt, type LoadedBrain } from '@/lib/ai/brain';

/**
 * The phone agent: how it sounds, and what it refuses to do.
 */

describe('preparing text for a voice', () => {
  it('reads a document number the way a person says it', () => {
    expect(forSpeech('Your quote QUO-0007 is ready.')).toBe('Your quote quote 7 is ready.');
    expect(forSpeech('INV-0031 is overdue')).toBe('invoice 31 is overdue');
    expect(forSpeech('JOB-0142 starts Monday')).toBe('job 142 starts Monday');
  });

  it('never reads out a URL', () => {
    expect(forSpeech('See https://example.com/q/abc123 for the quote')).toBe(
      'See the link I can text you for the quote'
    );
  });

  it('strips what a voice cannot pronounce', () => {
    expect(forSpeech('**Right**, the `job` is on ✅')).toBe('Right, the job is on');
    expect(forSpeech('- first\n- second')).toBe('first\nsecond');
  });

  it('leaves ordinary speech alone', () => {
    const line = "Yep, got it. Someone's out there Tuesday morning.";
    expect(forSpeech(line)).toBe(line);
  });
});

describe('the TwiML the caller hears', () => {
  it('lets the caller interrupt', () => {
    // Barge-in is what separates a conversation from an answering machine: the
    // caller can cut in halfway through a sentence.
    const xml = gather({ say: 'How can I help?', action: '/api/voice/turn' });
    expect(xml).toContain('bargeIn="true"');
    expect(xml).toContain('input="speech"');
    expect(xml).toContain('actionOnEmptyResult="true"');
  });

  it('escapes anything a caller could inject into the markup', () => {
    const xml = gather({
      say: 'The address is 5 & 7 "Main" <St>',
      action: '/api/voice/turn?id=1&x=2',
    });
    expect(xml).not.toMatch(/<St>/);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    // The document still parses as one Response with one Gather.
    expect(xml.match(/<Gather/g)).toHaveLength(1);
  });

  it('speaks Australian English by default', () => {
    expect(gather({ say: 'Hello', action: '/x' })).toContain('language="en-AU"');
    expect(sayAndHangUp('Bye')).toContain('language="en-AU"');
  });

  it('hands over to a person without dropping the call', () => {
    const xml = dial('+61400000000', { say: 'Putting you through now.' });
    expect(xml).toContain('<Dial');
    expect(xml).toContain('+61400000000');
    expect(xml).toContain('Putting you through now.');
  });
});

describe('the webhook signature', () => {
  const token = 'a-twilio-auth-token';
  const url = 'https://app.example.com/api/voice/incoming';
  const params = { CallSid: 'CA123', From: '+61400111222', To: '+61399998888' };

  const sign = (t: string, u: string, p: Record<string, string>) =>
    createHmac('sha1', t)
      .update(
        u +
          Object.keys(p)
            .sort()
            .map((key) => key + p[key])
            .join('')
      )
      .digest('base64');

  it('accepts a request Twilio actually signed', () => {
    expect(verifyTwilioSignature(token, url, params, sign(token, url, params))).toBe(true);
  });

  it('refuses a tampered parameter', () => {
    const signature = sign(token, url, params);
    const tampered = { ...params, From: '+61400999999' };
    expect(verifyTwilioSignature(token, url, tampered, signature)).toBe(false);
  });

  it('refuses a signature made for a different URL', () => {
    const signature = sign(token, 'https://app.example.com/api/voice/turn', params);
    expect(verifyTwilioSignature(token, url, params, signature)).toBe(false);
  });

  it('refuses a signature made with a different token', () => {
    expect(verifyTwilioSignature(token, url, params, sign('someone-elses-token', url, params))).toBe(
      false
    );
  });

  it('refuses when nothing is configured, rather than waving it through', () => {
    // A public URL that starts an AI conversation against a business's data
    // must fail closed.
    expect(verifyTwilioSignature(null, url, params, sign(token, url, params))).toBe(false);
    expect(verifyTwilioSignature(token, url, params, null)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, '')).toBe(false);
  });

  it('refuses a signature of the wrong length without leaking timing', () => {
    expect(verifyTwilioSignature(token, url, params, 'short')).toBe(false);
  });
});

describe('the system prompt the agent runs on', () => {
  const brain = (overrides: Partial<LoadedBrain['brain']> = {}): LoadedBrain => ({
    businessId: 'b1',
    businessName: 'Ridgeline Bricklaying',
    industry: {
      key: 'bricklayer',
      name: 'Bricklaying',
      terminology: ['course', 'DPC', 'perpend', 'weep hole'],
      common_services: ['Brick walls'],
      common_questions: ['Do you supply bricks?'],
    },
    faqs: [{ question: 'Do you do weekend work?', answer: 'Saturday mornings by arrangement.' }],
    knowledge: [{ title: 'Access', body: 'Site gate is locked after 4pm.', category: 'general' }],
    teamNames: ['Sam', 'Priya'],
    brain: {
      business_id: 'b1',
      industry_key: 'bricklayer',
      tone: 'friendly',
      voice_name: 'Polly.Nicole',
      speaking_rate: 1,
      language: 'en-AU',
      greeting: null,
      after_hours_greeting: null,
      voicemail_greeting: null,
      services: ['Brick walls', 'Retaining walls'],
      service_area: 'Inner West Sydney',
      business_hours: { monday: '7am–4pm' },
      emergency_hours: null,
      staff: [],
      escalation_name: 'Sam',
      escalation_phone: '0400 000 000',
      escalation_email: null,
      allowed_topics: [],
      forbidden_topics: ['insurance claims', 'legal disputes'],
      policies: null,
      pricing_guidance: null,
      disclose_ai: true,
      may_discuss_pricing: false,
      may_confirm_bookings: false,
      may_share_job_status: true,
      max_call_minutes: 10,
      enabled: true,
      phone_number: '+61399998888',
      ...overrides,
    },
  });

  it('is deterministic, so it can be cached', () => {
    expect(brainSystemPrompt(brain(), 'phone')).toBe(brainSystemPrompt(brain(), 'phone'));
  });

  it('carries the trade’s own vocabulary', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toContain('DPC');
    expect(prompt).toContain('perpend');
  });

  it('binds the agent to one business', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toContain('Ridgeline Bricklaying');
    expect(prompt).toMatch(/only this business/i);
  });

  it('states the disclosure rule without making it a refrain', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toMatch(/must not claim to be a human/i);
    expect(prompt).toMatch(/Do not repeat the disclosure unprompted/i);
  });

  it('carries the business’s forbidden topics verbatim', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toContain('insurance claims');
    expect(prompt).toContain('legal disputes');
    expect(prompt).toMatch(/Never discuss, under any framing/);
  });

  it('refuses to commit to a booking when the business has not allowed it', () => {
    expect(brainSystemPrompt(brain(), 'phone')).toMatch(/Do not confirm bookings/);
    expect(brainSystemPrompt(brain({ may_confirm_bookings: true }), 'phone')).toMatch(
      /repeat the date and time back/
    );
  });

  it('keeps one customer’s details away from another', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toMatch(/Never disclose another customer's details/);
    expect(prompt).toMatch(/If a caller cannot be identified, do not read out any record/);
  });

  it('tells it to be short, and to ask one thing at a time', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toMatch(/ONE or TWO short sentences/);
    expect(prompt).toMatch(/Ask ONE question at a time/);
    expect(prompt).toMatch(/no markdown, no emoji, no URLs/);
  });

  it('handles a frustrated caller without blaming anyone', () => {
    const prompt = brainSystemPrompt(brain(), 'phone');
    expect(prompt).toMatch(/do not blame anyone on the team, do not argue/i);
  });

  it('never sends an email on the email surface', () => {
    const prompt = brainSystemPrompt(brain(), 'email');
    expect(prompt).toMatch(/Never send anything/);
    expect(prompt).toMatch(/draft the person reviews and sends themselves/);
  });

  it('says nothing about the phone when it is answering the owner', () => {
    const prompt = brainSystemPrompt(brain(), 'assistant');
    expect(prompt).not.toMatch(/You are on a phone call/);
    expect(prompt).toMatch(/answering the business owner/i);
  });
});

describe('what the agent may do without a person', () => {
  const agent = readFileSync(
    join(import.meta.dirname, '..', 'src', 'lib', 'voice', 'agent.ts'),
    'utf8'
  );
  const afterCall = readFileSync(
    join(import.meta.dirname, '..', 'src', 'lib', 'voice', 'after-call.ts'),
    'utf8'
  );
  const emailActions = readFileSync(
    join(import.meta.dirname, '..', 'src', 'app', '(app)', 'emails', 'actions.ts'),
    'utf8'
  );

  it('proposes work rather than creating it', () => {
    // Everything the call produces lands in call_actions with a status, and a
    // person presses the button. Mis-heard speech never becomes a job.
    expect(agent).toMatch(/call_actions/);
    expect(afterCall).toMatch(/call_actions/);
    expect(afterCall).toMatch(/proposed/);
  });

  it('does not send email from the assistant', () => {
    // The assistant returns drafts. `sendAndRecord` appears only in the
    // compose action, which a person submits.
    const assistant = emailActions.slice(emailActions.indexOf('emailAssistAction'));
    expect(assistant).not.toMatch(/sendAndRecord|sendEmail\(/);
    expect(assistant).toMatch(/everything you produce is a draft|is a draft/i);
  });
});
