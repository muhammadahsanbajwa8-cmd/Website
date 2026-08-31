import Link from 'next/link';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  Icon,
  InfoNote,
  PageHeader,
  StatCard,
  icons,
} from '@/components/ui';
import { FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { TestCallLauncher } from './launcher';
import { formatDateTime, formatPhone, truncate } from '@/lib/format';
import type { Call } from '@/lib/database.types';

export const metadata = { title: 'Calls' };

const SENTIMENT = {
  positive: { label: 'Positive', tone: 'success' as const },
  neutral: { label: 'Neutral', tone: 'neutral' as const },
  frustrated: { label: 'Frustrated', tone: 'warning' as const },
  angry: { label: 'Angry', tone: 'danger' as const },
};

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('ai.use');
  const params = await searchParams;
  const search = param(params, 'q');
  const sentiment = param(params, 'sentiment');
  const escalated = param(params, 'escalated');
  const { page, from, to, pageSize } = pageFromParams(params);

  const supabase = await createClient();

  let query = supabase
    .from('calls')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (sentiment) query = query.eq('sentiment', sentiment as 'positive');
  if (escalated === '1') query = query.eq('escalated', true);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(
      `summary.ilike.${pattern},caller_name.ilike.${pattern},from_number.ilike.${pattern},intent.ilike.${pattern}`
    );
  }

  const { data, count } = await query.order('started_at', { ascending: false }).range(from, to);
  const calls = (data ?? []) as Call[];
  const customers = await lookup(
    'customers',
    idsFrom(calls, (call) => call.customer_id),
    'id, name, company'
  );

  const [{ data: brain }, { count: pendingActions }] = await Promise.all([
    supabase
      .from('ai_brain')
      .select('enabled, phone_number')
      .eq('business_id', session.business.id)
      .maybeSingle(),
    supabase
      .from('call_actions')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', session.business.id)
      .eq('applied', false)
      .eq('dismissed', false),
  ]);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  for (const [key, value] of [['q', search], ['sentiment', sentiment], ['escalated', escalated]] as const) {
    if (value) queryString.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Calls"
        description="Every call the assistant took, what it was about, and what it left you to do."
        actions={
          <>
            <ButtonLink href="/settings/ai" variant="secondary">
              <Icon path={icons.settings} size={16} />
              AI settings
            </ButtonLink>
            <TestCallLauncher />
          </>
        }
      />

      {!brain?.enabled ? (
        <div className="mb-5">
          <InfoNote>
            <strong>The phone assistant is switched off.</strong> You can still try it from here —
            a test call runs the same assistant with the same knowledge of your business, typed
            instead of spoken. Turn it on and point a number at it under{' '}
            <Link href="/settings/ai" className="underline">
              Settings → AI assistant
            </Link>
            .
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Calls recorded" value={count ?? 0} />
        <StatCard
          label="Waiting on you"
          value={pendingActions ?? 0}
          tone={(pendingActions ?? 0) > 0 ? 'warning' : 'neutral'}
          hint="Things callers asked for, not yet confirmed"
        />
        <StatCard
          label="Number"
          value={brain?.phone_number ? formatPhone(brain.phone_number) : 'Not connected'}
          hint={brain?.enabled ? 'Answering' : 'Off'}
        />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search summary, caller or number…" />
        <FilterSelect
          paramName="sentiment"
          label="Filter by sentiment"
          allLabel="Any sentiment"
          options={Object.entries(SENTIMENT).map(([value, meta]) => ({ value, label: meta.label }))}
        />
        <FilterSelect
          paramName="escalated"
          label="Filter by escalation"
          allLabel="All calls"
          options={[{ value: '1', label: 'Escalated only' }]}
        />
      </FilterBar>

      <DataTable
        rows={calls}
        hrefFor={(call) => `/calls/${call.id}`}
        empty={
          <EmptyState
            icon={<Icon path={icons.phone} size={20} />}
            title={search || sentiment ? 'No calls match that' : 'No calls yet'}
            description="Try a test call to hear how the assistant handles your customers before a real one arrives."
          />
        }
        columns={[
          {
            key: 'caller',
            header: 'Caller',
            render: (call) => {
              const customer = call.customer_id ? customers.get(call.customer_id) : null;
              return (
                <span>
                  <span className="block">
                    {customer ? customer.company || customer.name : call.caller_name || 'Unknown caller'}
                  </span>
                  <span className="block text-xs font-normal text-[var(--text-muted)]">
                    {call.from_number ? formatPhone(call.from_number) : 'Number withheld'}
                    {call.provider === 'console' ? ' · test' : ''}
                  </span>
                </span>
              );
            },
          },
          {
            key: 'summary',
            header: 'What it was about',
            render: (call) => (
              <span className="text-sm text-[var(--text-default)]">
                {truncate(call.summary ?? call.intent, 80) || '—'}
              </span>
            ),
          },
          {
            key: 'when',
            header: 'When',
            render: (call) => (
              <span className="text-sm">
                {formatDateTime(call.started_at)}
                {call.duration_seconds ? (
                  <span className="block text-xs text-[var(--text-muted)]">
                    {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s
                    {call.after_hours ? ' · after hours' : ''}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'sentiment',
            header: 'Sentiment',
            secondary: true,
            render: (call) => {
              if (!call.sentiment) return <span className="text-sm text-[var(--text-muted)]">—</span>;
              const meta = SENTIMENT[call.sentiment];
              return <Badge tone={meta.tone}>{meta.label}</Badge>;
            },
          },
          {
            key: 'flag',
            header: '',
            align: 'right',
            render: (call) =>
              call.escalated ? (
                <Badge tone="danger" dot>
                  Escalated
                </Badge>
              ) : call.status === 'in_progress' ? (
                <Badge tone="progress" dot>
                  Live
                </Badge>
              ) : null,
          },
        ]}
      />

      <Pagination info={info} basePath="/calls" query={queryString} />

      <Card className="mt-6">
        <CardBody>
          <h2 className="text-sm font-semibold text-[var(--text-strong)]">
            How the assistant knows your business
          </h2>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            It reads your services, hours, staff, service area and the answers you have written,
            plus the vocabulary of your trade. It recognises a caller by their number, finds the
            job they mean from a street name, and writes down what they asked for — but it never
            creates work on its own. Everything a caller asks for comes to you here first.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
