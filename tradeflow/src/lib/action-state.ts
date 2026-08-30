/**
 * The shape every server action returns, and the helpers that build it.
 *
 * Shared by server and client, so it must not import anything server-only.
 * A form gets back one of these and renders it: `fieldErrors` next to the
 * inputs, `error` at the top, `message` as a success note.
 */

import type { FieldErrors } from './validation';

export interface ActionState {
  ok: boolean;
  /** Something went wrong that the whole form should show. */
  error?: string;
  /** Per-field validation messages, keyed by input name. */
  fieldErrors?: FieldErrors;
  /** Confirmation to show on success. */
  message?: string;
  /** Anything the form wants back — a new record's id, for example. */
  data?: Record<string, unknown>;
}

export const idleState: ActionState = { ok: false };

export function ok(message?: string, data?: Record<string, unknown>): ActionState {
  return { ok: true, message, data };
}

export function fail(error: string, fieldErrors?: FieldErrors): ActionState {
  return { ok: false, error, fieldErrors };
}

export function invalid(fieldErrors: FieldErrors, error = 'Check the highlighted fields'): ActionState {
  return { ok: false, error, fieldErrors };
}

/**
 * Turn whatever was thrown into something a person can read.
 *
 * Postgres error codes are mapped rather than shown: `23505` on a customer
 * insert means "that name is already used", not "duplicate key value violates
 * unique constraint customers_business_name_uniq".
 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'PermissionError') return error.message;

  const pg = error as { code?: string; message?: string; details?: string; hint?: string };
  switch (pg?.code) {
    case '23505':
      return 'That already exists. Try a different name or reference.';
    case '23503':
      return 'That refers to something which no longer exists. Refresh and try again.';
    case '23514':
      return 'One of those values is out of range.';
    case '42501':
    case 'PGRST301':
      return 'Your role does not allow that. Ask an owner or admin.';
    case 'PGRST116':
      return 'That record was not found, or is not yours to open.';
    case '22P02':
      return 'One of those values was not in the expected format.';
    default:
      break;
  }

  if (pg?.message) {
    // Never surface a raw Postgres policy failure; it names internal tables.
    if (/row-level security|violates row-level/i.test(pg.message)) {
      return 'Your role does not allow that. Ask an owner or admin.';
    }
    return pg.message;
  }
  return 'Something went wrong. Try again.';
}
