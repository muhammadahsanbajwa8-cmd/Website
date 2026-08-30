'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireBusiness } from '@/lib/session';

/** Clear the unread badge. Called when the notification tray is opened. */
export async function markNotificationsReadAction(): Promise<void> {
  const session = await requireBusiness();
  const supabase = await createClient();

  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('business_id', session.business.id)
    .eq('user_id', session.userId)
    .is('read_at', null);

  revalidatePath('/', 'layout');
}
