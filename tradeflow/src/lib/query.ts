import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Row, TableName } from '@/lib/database.types';

/**
 * Reading related records.
 *
 * The application does not use PostgREST's embedded selects
 * (`jobs?select=*,customers(*)`). Two reasons: a table with two foreign keys
 * onto the same target (job_tasks has both `assigned_to` and `verified_by`
 * pointing at team_members) needs the relationship spelled out or the request
 * is ambiguous; and the return type of an embed depends on relationship
 * metadata that has to be generated from a live database.
 *
 * Instead a list query fetches its parents, and `lookup()` fetches the related
 * rows for the whole page in one further query. Two round trips for a page of
 * fifty jobs, not fifty-one, and every field is typed.
 */

/** Distinct, non-null ids from a page of rows. */
export function idsFrom<T>(rows: T[], pick: (row: T) => string | null | undefined): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const id = pick(row);
    if (id) set.add(id);
  }
  return [...set];
}

/**
 * Fetch the rows of `table` with those ids, as a Map keyed by id.
 * Returns an empty map for an empty id list without hitting the database.
 */
export async function lookup<T extends TableName>(
  table: T,
  ids: string[],
  columns = '*'
): Promise<Map<string, Row<T>>> {
  const map = new Map<string, Row<T>>();
  if (ids.length === 0) return map;

  const supabase = await createClient();
  // The filter value is cast because `table` is generic here: the client
  // cannot narrow the column type of a table it does not know yet. Every
  // caller passes a uuid table, and the query itself is still tenant-filtered
  // by row level security.
  const { data } = await supabase
    .from(table)
    .select(columns)
    .in('id', ids as never);

  for (const row of (data ?? []) as unknown as Row<T>[]) {
    const id = (row as unknown as { id?: string }).id;
    if (id) map.set(id, row);
  }
  return map;
}

/** As `lookup`, but keyed by a column other than `id` (e.g. `job_id`). */
export async function group<T extends TableName>(
  table: T,
  column: string,
  values: string[],
  columns = '*'
): Promise<Map<string, Row<T>[]>> {
  const map = new Map<string, Row<T>[]>();
  if (values.length === 0) return map;

  const supabase = await createClient();
  const { data } = await supabase
    .from(table)
    .select(columns)
    .in(column as never, values as never);

  for (const row of (data ?? []) as unknown as Row<T>[]) {
    const key = (row as unknown as Record<string, unknown>)[column];
    if (typeof key !== 'string') continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

// --- pagination -------------------------------------------------------------

export const PAGE_SIZE = 25;

export interface PageInfo {
  page: number;
  pageSize: number;
  from: number;
  to: number;
  total: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function pageFromParams(
  searchParams: Record<string, string | string[] | undefined>,
  pageSize = PAGE_SIZE
): { page: number; from: number; to: number; pageSize: number } {
  const raw = searchParams.page;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Math.max(1, Number.parseInt(value ?? '1', 10) || 1);
  const from = (page - 1) * pageSize;
  return { page, from, to: from + pageSize - 1, pageSize };
}

export function pageInfo(
  page: number,
  pageSize: number,
  total: number
): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    from: (page - 1) * pageSize,
    to: Math.min(page * pageSize, total),
    total,
    pageCount,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}

/** First value of a search param, whatever shape Next hands over. */
export function param(
  searchParams: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() !== '' ? first : undefined;
}

/**
 * Escape a user's search text for PostgREST's `or(...)` filter syntax, where
 * a comma separates conditions and a parenthesis ends the list. Without this,
 * searching for "Smith, J (site)" produces a malformed query.
 */
export function escapeFilterValue(text: string): string {
  return text.replace(/[,()\\]/g, ' ').replace(/%/g, '').trim();
}

/** A `%term%` pattern for `ilike`, safe to interpolate. */
export function likePattern(text: string): string {
  return `%${escapeFilterValue(text)}%`;
}
