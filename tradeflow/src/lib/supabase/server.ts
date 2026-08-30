import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import type { Database } from '@/lib/database.types';

/**
 * The request-scoped client. Every query it makes runs as the signed-in user,
 * so row level security applies to it — this is the client the whole
 * application uses, and the reason a page cannot accidentally read another
 * tenant's rows.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session on every request, so there is
          // nothing to recover here.
        }
      },
    },
  });
}
