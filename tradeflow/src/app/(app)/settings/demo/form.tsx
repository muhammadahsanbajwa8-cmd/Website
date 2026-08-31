'use client';

import { useActionState } from 'react';
import { clearDemoAction, loadDemoAction } from './actions';
import { idleState } from '@/lib/action-state';
import { Card, CardBody, CardHeader, FormError, FormSuccess } from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';

const LABELS: Record<string, string> = {
  customers: 'Customers',
  suppliers: 'Suppliers',
  materials: 'Materials',
  leads: 'Leads',
  jobs: 'Jobs',
  tasks: 'Tasks',
  estimates: 'Estimates',
  quotes: 'Quotes',
  invoices: 'Invoices',
  payments: 'Payments',
  reports: 'Reports',
  workLogs: 'Timesheets',
  expenses: 'Expenses',
  faqs: 'Assistant answers',
  knowledge: 'Assistant notes',
};

export function DemoControls({ hasDemoData }: { hasDemoData: boolean }) {
  const [loadState, load] = useActionState(loadDemoAction, idleState);
  const [clearState, clear] = useActionState(clearDemoAction, idleState);

  const created = (loadState.data?.created ?? null) as Record<string, number> | null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Load the demo"
          description="A bricklaying business with jobs at every stage — a quote that was accepted, an invoice part paid, another overdue, site reports, timesheets and receipts."
        />
        <CardBody>
          <form action={load} className="space-y-4">
            <FormError>{loadState.error}</FormError>
            {loadState.ok && loadState.message ? (
              <FormSuccess>{loadState.message}</FormSuccess>
            ) : null}

            {created ? (
              <ul className="grid gap-x-6 gap-y-1 text-sm text-[var(--text-muted)] sm:grid-cols-2">
                {Object.entries(created)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => (
                    <li key={key} className="flex justify-between border-b border-[var(--line-subtle)] py-1">
                      <span>{LABELS[key] ?? key}</span>
                      <span className="tabular-nums text-[var(--text-strong)]">{count}</span>
                    </li>
                  ))}
              </ul>
            ) : null}

            <SubmitButton pendingLabel="Loading the demo…">
              {hasDemoData ? 'Load it again' : 'Load demo data'}
            </SubmitButton>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Clear the demo"
          description="Removes every record marked “[demo]”, and nothing else. Anything you entered yourself stays exactly as it is."
        />
        <CardBody>
          <form action={clear} className="space-y-4">
            <FormError>{clearState.error}</FormError>
            {clearState.ok && clearState.message ? (
              <FormSuccess>{clearState.message}</FormSuccess>
            ) : null}

            <ConfirmSubmit
              confirmTitle="Clear the demo data?"
              confirmBody="Every record marked [demo] is removed. Your own records are not touched."
              confirmLabel="Clear it"
            >
              Clear the demo
            </ConfirmSubmit>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
