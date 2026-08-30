'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * The browser client, used for the few things that must happen client-side:
 * uploading a photo straight to storage, and subscribing to notifications.
 * It carries the anon key and the user's session, so RLS applies to it too.
 */
export function createClient() {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return cached;
}
