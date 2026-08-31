import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

/**
 * The Anthropic client, and the two answers the rest of the AI code needs:
 * is a key configured, and which model should this call use.
 *
 * Everything here goes through the official SDK. Nothing in the application
 * ever hand-rolls an HTTP call to the API.
 */

let cached: Anthropic | null = null;

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      'The AI assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local ' +
        'and restart — everything else in the platform works without it.'
    );
    this.name = 'AiNotConfiguredError';
  }
}

export function aiConfigured(): boolean {
  return Boolean(env.anthropicKey);
}

export function anthropic(): Anthropic {
  if (!env.anthropicKey) throw new AiNotConfiguredError();
  if (!cached) cached = new Anthropic({ apiKey: env.anthropicKey });
  return cached;
}

export function model(): string {
  return env.anthropicModel;
}

/**
 * Effort levels, chosen per surface rather than globally.
 *
 * A phone call is the hard constraint: a caller hears every millisecond of
 * thinking as silence, so voice turns run at low effort with short output.
 * The business assistant and the after-call extraction are not waiting on a
 * human's ear and can think properly.
 */
export const EFFORT = {
  /** A live phone turn. Latency is the whole game. */
  voice: 'low',
  /** Email drafting and summarising. */
  email: 'medium',
  /** Questions over the business's own data, and after-call extraction. */
  assistant: 'high',
} as const;

export type Effort = (typeof EFFORT)[keyof typeof EFFORT];

/** Pull the plain text out of a response, ignoring thinking and tool blocks. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Turn an SDK failure into something a person reads without alarm. A phone
 * caller must never hear a stack trace, and an office user should be told
 * whether the problem is theirs to fix.
 */
export function describeAiError(error: unknown): string {
  if (error instanceof AiNotConfiguredError) return error.message;

  if (error instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'The assistant is rate limited at the moment. Try again shortly.';
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The assistant could not handle that request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'The assistant could not be reached. Check the network and try again.';
  }
  if (error instanceof Anthropic.APIError) {
    return `The assistant returned an error (${error.status}). Try again.`;
  }
  return 'The assistant is unavailable right now.';
}

export type { Anthropic };
