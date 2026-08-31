-- ===========================================================================
-- 0008 — money that has not arrived is not revenue
--
-- 0007 gave payments a status, because a card payment exists before it has
-- settled. `recalc_invoice_payments` was updated to count only `succeeded`,
-- but the dashboard was still summing every row: a customer who reached
-- Stripe's checkout page and abandoned it would have appeared on the owner's
-- dashboard as money received.
--
-- All three payment sums in `dashboard_summary` — this year, the last thirty
-- days, and the twelve-month chart — now count settled money only, less
-- anything refunded. Every key it returns is unchanged, because the dashboard
-- reads them by name.
--
-- `job_profitability` needs no change: it reads `invoices.paid_cents`, which
-- the trigger already maintains from settled payments only.
-- ===========================================================================

create or replace function dashboard_summary(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if not app_is_member(target) then
    raise exception 'not a member of business %', target using errcode = '42501';
  end if;

  return jsonb_build_object(
    'revenue_cents', (
      select coalesce(sum(p.amount_cents - p.refunded_cents), 0) from payments p
       where p.business_id = target and p.deleted_at is null
                            and p.status = 'succeeded'
         and p.paid_on >= date_trunc('year', today)::date),
    'revenue_30d_cents', (
      select coalesce(sum(p.amount_cents - p.refunded_cents), 0) from payments p
       where p.business_id = target and p.deleted_at is null
                            and p.status = 'succeeded'
         and p.paid_on >= today - 30),
    'outstanding_cents', (
      select coalesce(sum(i.total_cents - i.paid_cents), 0) from invoices i
       where i.business_id = target and i.deleted_at is null
         and i.status in ('sent', 'viewed', 'partially_paid', 'overdue')),
    'overdue_cents', (
      select coalesce(sum(i.total_cents - i.paid_cents), 0) from invoices i
       where i.business_id = target and i.deleted_at is null
         and i.status <> 'paid' and i.status <> 'draft' and i.status <> 'cancelled'
         and i.due_date is not null and i.due_date < today),
    'overdue_count', (
      select count(*) from invoices i
       where i.business_id = target and i.deleted_at is null
         and i.status <> 'paid' and i.status <> 'draft' and i.status <> 'cancelled'
         and i.due_date is not null and i.due_date < today),
    'open_quotes_cents', (
      select coalesce(sum(q.total_cents), 0) from quotes q
       where q.business_id = target and q.deleted_at is null
         and q.status in ('sent', 'viewed', 'changes_requested')),
    'open_quotes_count', (
      select count(*) from quotes q
       where q.business_id = target and q.deleted_at is null
         and q.status in ('sent', 'viewed', 'changes_requested')),
    'active_jobs', (
      select count(*) from jobs j
       where j.business_id = target and j.deleted_at is null
         and j.status in ('scheduled', 'in_progress', 'accepted')),
    'tasks_due', (
      select count(*) from job_tasks t
       where t.business_id = target and t.deleted_at is null
         and t.status in ('open', 'in_progress')
         and t.due_date is not null and t.due_date <= today),
    'tasks_open', (
      select count(*) from job_tasks t
       where t.business_id = target and t.deleted_at is null
         and t.status in ('open', 'in_progress')),
    'expenses_30d_cents', (
      select coalesce(sum(e.amount_cents), 0) from expenses e
       where e.business_id = target and e.deleted_at is null
         and e.spent_on >= today - 30),
    'expenses_ytd_cents', (
      select coalesce(sum(e.amount_cents), 0) from expenses e
       where e.business_id = target and e.deleted_at is null
         and e.spent_on >= date_trunc('year', today)::date),
    'unread_emails', (
      select count(*) from emails m
       where m.business_id = target and m.deleted_at is null
         and m.direction = 'inbound' and not m.is_read),
    'revenue_by_month', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select to_char(d.month, 'YYYY-MM') as month,
               coalesce((select sum(p.amount_cents - p.refunded_cents) from payments p
                          where p.business_id = target and p.deleted_at is null
                            and p.status = 'succeeded'
                            and date_trunc('month', p.paid_on) = d.month), 0) as revenue_cents,
               coalesce((select sum(e.amount_cents) from expenses e
                          where e.business_id = target and e.deleted_at is null
                            and date_trunc('month', e.spent_on) = d.month), 0) as expenses_cents
          from generate_series(date_trunc('month', today) - interval '11 months',
                               date_trunc('month', today), interval '1 month') as d(month)
         order by d.month
      ) t),
    'jobs_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select j.status::text as status, count(*) as n from jobs j
         where j.business_id = target and j.deleted_at is null
         group by j.status) s)
  );
end $$;

grant execute on function dashboard_summary(uuid) to authenticated;


-- --- pricing a payment from a share token -----------------------------------

-- The customer's browser must never say what to charge. This returns what the
-- invoice actually owes, read from the row, for the checkout route to price
-- with — along with which connected account the money should go to.
create or replace function public_invoice_payable(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i invoices%rowtype;
  b businesses%rowtype;
  c customers%rowtype;
begin
  if p_token is null or length(p_token) < 20 then
    return null;
  end if;

  select * into i from invoices
   where share_token = p_token and deleted_at is null
     and status not in ('draft', 'cancelled');
  if i.id is null then return null; end if;

  select * into b from businesses where id = i.business_id;
  select * into c from customers where id = i.customer_id;

  return jsonb_build_object(
    'invoice_id', i.id,
    'business_id', i.business_id,
    'customer_id', i.customer_id,
    'number', i.number,
    'title', coalesce(i.title, 'Invoice ' || i.number),
    'amount_due_cents', greatest(i.total_cents - i.paid_cents, 0),
    'total_cents', i.total_cents,
    'paid_cents', i.paid_cents,
    'status', i.status,
    'business_name', b.name,
    'stripe_account_id', b.stripe_account_id,
    'stripe_charges_enabled', b.stripe_charges_enabled,
    'platform_fee_bp', b.platform_fee_bp,
    'customer_email', c.email
  );
end $$;

-- Deliberately NOT granted to anon: it carries the connected account id and
-- the platform fee, which are the business's business, not the customer's.
-- The checkout route calls it with the service role after checking the token.
revoke all on function public_invoice_payable(text) from public;

-- --- the same self-check ----------------------------------------------------

do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ')
    into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname <> 'schema_migrations'
     and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid));

  if offenders is not null then
    raise exception 'tables without row level security or without any policy: %', offenders;
  end if;
end $$;
