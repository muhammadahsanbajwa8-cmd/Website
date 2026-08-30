import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from '@/lib/database.types';

/**
 * The service-role client. It bypasses row level security, so it is used only
 * where the operation is genuinely not a user's own query and the tenant has
 * already been established by the caller:
 *
 *   - signing storage URLs for a file whose row the user has already read;
 *   - reading and writing encrypted mailbox tokens, which no user may read;
 *   - the seeder and the migration runner.
 *
 * Anything else goes through createClient() in ./server so the database
 * enforces tenancy rather than this file's author remembering to.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
