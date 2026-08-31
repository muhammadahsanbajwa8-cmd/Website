import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, pageFromParams, pageInfo, param } from '@/lib/query';
import { deleteExpenseAction } from '../field/actions';
import { Badge, ButtonLink, EmptyState, Icon, PageHeader, StatCard, icons } from '@/components/ui';
import { ConfirmSubmit, FilterSelect, SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar, Pagination } from '@/components/list';
import { formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { COST_KINDS, type CostKind } from '@/lib/calc';
import type { Expense } from '@/lib/database.types';

export const metadata = { title: 'Expenses' };

const KIND_LABEL = new Map(COST_KINDS.map((k) => [k.value as string, k.label]));

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('expenses.create');
  const params = await searchParams;
  const search = param(params, 'q');
  const category = param(params, 'category');
  const jobId = param(params, 'job');
  const { page, from, to, pageSize } = pageFromParams(params);
  const today = todayInAustralia();

  const supabase = await createClient();
  let query = supabase
    .from('expenses')
    .select('*', { count: 'exact' })
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (category) query = query.eq('category', category as CostKind);
  if (jobId) query = query.eq('job_id', jobId);
  if (search) {
    const pattern = likePattern(search);
    query = query.or(`description.ilike.${pattern},reference.ilike.${pattern},notes.ilike.${pattern}`);
  }

  const { data, count } = await query.order('spent_on', { ascending: false }).range(from, to);
  const expenses = (data ?? []) as Expense[];
  const jobs = await lookup('jobs', idsFrom(expenses, (e) => e.job_id), 'id, number, name');

  const { data: allRows } = await supabase
    .from('expenses')
    .select('amount_cents, gst_cents, spent_on')
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  const rows = allRows ?? [];
  const thisMonth = today.slice(0, 7);
  const monthTotal = rows
    .filter((row) => row.spent_on.startsWith(thisMonth))
    .reduce((n, row) => n + row.amount_cents, 0);
  const yearTotal = rows
    .filter((row) => row.spent_on.startsWith(today.slice(0, 4)))
    .reduce((n, row) => n + row.amount_cents, 0);
  const gstTotal = rows
    .filter((row) => row.spent_on.startsWith(today.slice(0, 4)))
    .reduce((n, row) => n + row.gst_cents, 0);

  const info = pageInfo(page, pageSize, count ?? 0);
  const queryString = new URLSearchParams();
  for (const [key, value] of [['q', search], ['category', category], ['job', jobId]] as const) {
    if (value) queryString.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Materials, fuel, tools, plant, travel and subbies — against the job that used them."
        actions={
          <ButtonLink href="/expenses/new">
            <Icon path={icons.plus} size={18} />
            Add expense
          </ButtonLink>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="This month" value={formatMoney(monthTotal)} />
        <StatCard label="This year" value={formatMoney(yearTotal)} />
        <StatCard label="GST paid this year" value={formatMoney(gstTotal)} />
      </div>

      <FilterBar>
        <SearchInput placeholder="Search description or reference…" />
        <FilterSelect
          paramName="category"
          label="Filter by category"
          allLabel="All categories"
          options={COST_KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />
      </FilterBar>

      <DataTable
        rows={expenses}
        empty={
          <EmptyState
            icon={<Icon path={icons.expenses} size={20} />}
            title={search || category ? 'Nothing matches that' : 'No expenses recorded'}
            description="Photograph the docket on site and it lands against the job."
            action={<ButtonLink href="/expenses/new">Record an expense</ButtonLink>}
          />
        }
        columns={[
          {
            key: 'description',
            header: 'Expense',
            render: (expense) => (
              <span>
                <span className="block">{expense.description}</span>
                <span className="block text-xs font-normal text-[var(--text-muted)]">
                  {formatDate(expense.spent_on)}
                  {expense.reference ? ` · ${expense.reference}` : ''}
                </span>
              </span>
            ),
          },
          {
            key: 'job',
            header: 'Job',
            render: (expense) => {
              const job = expense.job_id ? jobs.get(expense.job_id) : null;
              return <span className="text-sm">{job ? job.number : '—'}</span>;
            },
          },
          {
            key: 'category',
            header: 'Category',
            render: (expense) => (
              <Badge>{KIND_LABEL.get(expense.category) ?? expense.category}</Badge>
            ),
          },
          {
            key: 'gst',
            header: 'GST',
            align: 'right',
            secondary: true,
            render: (expense) => (
              <span className="tabular text-sm text-[var(--text-muted)]">
                {formatMoney(expense.gst_cents)}
              </span>
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (expense) => (
              <span className="tabular text-sm font-medium">{formatMoney(expense.amount_cents)}</span>
            ),
          },
          ...(session.can('expenses.edit')
            ? [
                {
                  key: 'actions',
                  header: '',
                  align: 'right' as const,
                  render: (expense: Expense) => (
                    <form action={deleteExpenseAction}>
                      <input type="hidden" name="id" value={expense.id} />
                      <ConfirmSubmit
                        confirmTitle="Remove this expense?"
                        confirmBody="It comes off the job's cost total."
                        confirmLabel="Remove"
                      >
                        <Icon path={icons.trash} size={14} />
                      </ConfirmSubmit>
                    </form>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Pagination info={info} basePath="/expenses" query={queryString} />
    </>
  );
}
