import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TwiML, and the signature check that guards it.
 *
 * TwiML is Twilio's XML, but the shape — say something, listen, post the
 * result back — is what every telephony provider offers under a different
 * name. The agent itself knows nothing about any of it: `handleTurn` takes a
 * string and returns a string, and this file is the only place that would
 * change to put a different carrier in front of it.
 *
 * `bargeIn` is the setting that makes the agent feel human. With it on, the
 * moment the caller starts talking the prompt stops playing and what they said
 * is captured — so "yeah, I know, but when's someone coming?" cuts the agent
 * off exactly the way it would cut off a person.
 */

export interface GatherOptions {
  /** What the agent says before listening. */
  say: string;
  /** Where the caller's speech is posted. */
  action: string;
  language?: string;
  voice?: string;
  /** Silence, in seconds, that ends the caller's turn. */
  speechTimeout?: number;
  /** Whole-turn ceiling, in seconds. */
  timeout?: number;
  /** Let the caller talk over the prompt. On by default — this is the point. */
  bargeIn?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Prepare text for a text-to-speech engine.
 *
 * Written English and spoken English differ, and the gap is audible. A quote
 * number read as "Q-U-O-hyphen-zero-zero-zero-seven" sounds like a machine;
 * "quote seven" sounds like a person. Markdown, URLs and emoji are stripped
 * because there is no way to pronounce them.
 */
export function forSpeech(text: string): string {
  return text
    // Markdown emphasis and headings never survive to the ear.
    .replace(/[*_`#]+/g, '')
    // Bullets become sentences.
    .replace(/^\s*[-•]\s*/gm, '')
    // Document numbers: "QUO-0007" -> "quote seven".
    .replace(/\bQUO-0*(\d+)\b/gi, 'quote $1')
    .replace(/\bINV-0*(\d+)\b/gi, 'invoice $1')
    .replace(/\bJOB-0*(\d+)\b/gi, 'job $1')
    .replace(/\bEST-0*(\d+)\b/gi, 'estimate $1')
    .replace(/\bREP-0*(\d+)\b/gi, 'report $1')
    // A URL is unspeakable; the caller gets it by text or email instead.
    .replace(/https?:\/\/\S+/g, 'the link I can text you')
    // Emoji and symbols the voice would either skip or name aloud.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function gather(options: GatherOptions): string {
  const speech = escapeXml(forSpeech(options.say));
  const language = options.language ?? 'en-AU';
  const voice = options.voice ?? 'Polly.Nicole';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech"
          action="${escapeXml(options.action)}"
          method="POST"
          language="${escapeXml(language)}"
          speechTimeout="${options.speechTimeout ?? 'auto'}"
          timeout="${options.timeout ?? 8}"
          bargeIn="${options.bargeIn === false ? 'false' : 'true'}"
          actionOnEmptyResult="true">
    <Say voice="${escapeXml(voice)}" language="${escapeXml(language)}">${speech}</Say>
  </Gather>
</Response>`;
}

export function sayAndHangUp(text: string, options: { language?: string; voice?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(options.voice ?? 'Polly.Nicole')}" language="${escapeXml(options.language ?? 'en-AU')}">${escapeXml(forSpeech(text))}</Say>
  <Hangup/>
</Response>`;
}

export function sayAndRedirect(text: string, action: string, options: { language?: string; voice?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(options.voice ?? 'Polly.Nicole')}" language="${escapeXml(options.language ?? 'en-AU')}">${escapeXml(forSpeech(text))}</Say>
  <Redirect method="POST">${escapeXml(action)}</Redirect>
</Response>`;
}

/** Hand the call to a person. */
export function dial(number: string, options: { say?: string; language?: string; voice?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${options.say ? `<Say voice="${escapeXml(options.voice ?? 'Polly.Nicole')}" language="${escapeXml(options.language ?? 'en-AU')}">${escapeXml(forSpeech(options.say))}</Say>` : ''}
  <Dial timeout="25">${escapeXml(number)}</Dial>
</Response>`;
}

/**
 * Twilio's request signature.
 *
 * The webhook is a public URL that starts an AI conversation against a
 * business's data, so it must not accept a request from anyone who guesses the
 * path. The signature is HMAC-SHA1 over the URL plus the POST parameters
 * sorted by key, base64-encoded — checked in constant time.
 *
 * With no auth token configured the check returns false and the route refuses
 * the request, rather than waving it through.
 */
export function verifyTwilioSignature(
  authToken: string | null,
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (!authToken || !signature) return false;

  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');

  const expected = createHmac('sha1', authToken).update(Buffer.from(payload, 'utf8')).digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Read a form-encoded webhook body into a plain object. */
export async function readFormBody(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}

export const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' };
