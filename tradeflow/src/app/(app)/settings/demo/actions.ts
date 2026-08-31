'use server';

import { revalidatePath } from 'next/cache';
import { audit, requireCapability } from '@/lib/session';
import { clearDemoData, loadDemoData } from '@/lib/demo';
import { describeError, fail, ok, type ActionState } from '@/lib/action-state';

/**
 * Loading and clearing the demo.
 *
 * Only an owner or admin can do either, because both write to every table the
 * business has. Loading is additive and clearing removes only what was loaded,
 * so neither can touch a record the business entered itself.
 */

const TOUCHED = [
  '/dashboard',
  '/jobs',
  '/customers',
  '/leads',
  '/estimates',
  '/quotes',
  '/invoices',
  '/reports',
  '/timesheets',
  '/expenses',
  '/materials',
  '/tasks',
  '/settings/ai',
  '/settings/demo',
];

const refresh = () => {
  for (const path of TOUCHED) revalidatePath(path);
};

export async function loadDemoAction(
  _previous: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');

  try {
    const result = await loadDemoData(session);
    if (result.error) return fail(result.error);

    const total = Object.values(result.created).reduce((sum, count) => sum + count, 0);
    await audit(session.business.id, {
      action: 'demo.load',
      entityType: 'business',
      entityId: session.business.id,
      detail: result.created,
    });

    refresh();
    return ok(
      `Loaded ${total} demo records. Every one is marked “[demo]”, and “Clear the demo” takes ` +
        'them all back out.',
      { created: result.created }
    );
  } catch (error) {
    return fail(describeError(error));
  }
}

export async function clearDemoAction(
  _previous: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('business.edit');

  try {
    const { removed } = await clearDemoData(session);

    await audit(session.business.id, {
      action: 'demo.clear',
      entityType: 'business',
      entityId: session.business.id,
      detail: { removed },
    });

    refresh();
    return removed === 0
      ? ok('There was no demo data to clear.')
      : ok(`Cleared ${removed} demo records. Anything you entered yourself is untouched.`);
  } catch (error) {
    return fail(describeError(error));
  }
}
