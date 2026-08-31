import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { Card, CardBody, InfoNote, PageHeader } from '@/components/ui';
import { DemoControls } from './form';

export const metadata = { title: 'Demo data' };

export default async function DemoSettingsPage() {
  const session = await requireBusiness();
  const supabase = await createClient();

  // One cheap count is enough to know whether the demo is already loaded.
  const { count } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .ilike('notes', '%[demo]%');

  const hasDemoData = (count ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Demo data"
        description="A worked example, so every screen has something real on it before you have entered anything."
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
      />

      <div className="mb-5">
        <InfoNote tone={hasDemoData ? 'success' : 'info'}>
          {hasDemoData
            ? 'The demo is loaded. Everything it created is marked “[demo]” — clear it whenever you like.'
            : 'Nothing demo is loaded. Anything the demo creates is marked “[demo]” so it never gets confused with your own work.'}
        </InfoNote>
      </div>

      {session.can('business.edit') ? (
        <DemoControls hasDemoData={hasDemoData} />
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Only an owner or admin can load or clear the demo data.
            </p>
          </CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardBody>
          <h2 className="text-sm font-medium text-[var(--text-strong)]">What it puts in</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
            Three customers, two suppliers and a short materials list. Four jobs — one in progress,
            one scheduled, one finished, one still being priced. An estimate with labour, materials,
            plant, travel and a subcontractor, marked up to a quote that was accepted, invoiced, and
            part paid. A second invoice past its due date. Two site reports, one of them a defect. A
            week of timesheets, three receipts, and a set of tasks. The phone assistant is filled in
            as a bricklayer, with its own answers to the questions that come up most.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
