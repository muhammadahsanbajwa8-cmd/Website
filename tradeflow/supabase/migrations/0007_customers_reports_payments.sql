-- ===========================================================================
-- 0007 — customer accounts, sendable reports, and real payments
--
-- Three things this adds, and one thing it is careful not to break.
--
--   1. A customer can have a login. Until now a customer reached a quote only
--      through a share token; there was no "their account". `customer_users`
--      links an auth user to a customer record, and the policies below let
--      that person read their own jobs, reports, invoices and payments — and
--      nothing else, in any business.
--
--   2. A report can be sent. Reports had a PDF but no way to reach the person
--      who needed it, so `share_token` and the send columns are added, and a
--      definer function serves the customer's copy by token.
--
--   3. A payment can be taken online. The `payments` table recorded money that
--      had already arrived; it now also carries a provider, a status and the
--      provider's own id. Only a `succeeded` payment counts towards what an
--      invoice has been paid — the recalculation is updated for that below,
--      so a pending card payment never marks an invoice paid.
--
-- The care: every existing staff policy is left exactly as it was. Customer
-- access is added as a separate clause, so widening this never silently
-- widens what a team member can reach.
-- ===========================================================================

-- --- reports a customer can be sent -----------------------------------------

alter table reports
  add column if not exists share_token text unique,
  add column if not exists sent_to text,
  add column if not exists send_error text,
  add column if not exists send_count integer not null default 0,
  add column if not exists viewed_at timestamptz,
  add column if not exists completed_at timestamptz;

comment on column reports.share_token is
  'Minted when the report is first sent. The customer opens /r/<token> — no account needed.';
comment on column reports.send_count is
  'How many times it has been emailed. Guards against a double tap sending twice.';

create index if not exists reports_share_token_idx on reports (share_token)
  where share_token is not null;

-- --- customer logins --------------------------------------------------------

create table if not exists customer_users (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  email        citext not null,
  invite_token text unique,
  invited_at   timestamptz,
  accepted_at  timestamptz,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index if not exists customer_users_customer_email_uniq
  on customer_users (customer_id, email) where deleted_at is null;
create index if not exists customer_users_user_idx
  on customer_users (user_id) where deleted_at is null;

comment on table customer_users is
  'A person who can sign in and see one customer''s records. Separate from team_members: a customer is not staff and holds no role in the business.';

-- --- payments that a provider took ------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum
      ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
  end if;
end $$;

alter table payments
  add column if not exists provider text not null default 'manual'
    check (provider in ('manual', 'stripe')),
  add column if not exists status payment_status not null default 'succeeded',
  add column if not exists provider_payment_id text,
  add column if not exists provider_fee_cents bigint not null default 0
    check (provider_fee_cents >= 0),
  add column if not exists platform_fee_cents bigint not null default 0
    check (platform_fee_cents >= 0),
  add column if not exists refunded_cents bigint not null default 0
    check (refunded_cents >= 0),
  add column if not exists receipt_url text,
  add column if not exists failure_reason text,
  add column if not exists paid_at timestamptz;

-- One row per provider payment. Webhooks arrive more than once; this is what
-- makes handling them twice a no-op rather than a double credit.
create unique index if not exists payments_provider_payment_uniq
  on payments (provider, provider_payment_id)
  where provider_payment_id is not null;

comment on column payments.status is
  'Only `succeeded` counts towards an invoice. Set by the webhook from the provider''s own record, never by anything a customer can send.';

-- --- the business's connected payment account -------------------------------

alter table businesses
  add column if not exists stripe_account_id text unique,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_connected_at timestamptz,
  -- Basis points the platform takes from a payment. Zero until the platform
  -- charges anything; here so adding a fee later is a setting, not a rewrite.
  add column if not exists platform_fee_bp integer not null default 0
    check (platform_fee_bp between 0 and 10000);

comment on column businesses.stripe_account_id is
  'A Stripe Connect account belonging to this business. Money is paid to them, not to the platform.';

-- --- provider events, so a webhook is handled exactly once -------------------

create table if not exists payment_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references businesses(id) on delete cascade,
  provider     text not null default 'stripe',
  event_id     text not null,
  event_type   text not null,
  payload      jsonb not null default '{}'::jsonb,
  handled      boolean not null default false,
  error        text,
  created_at   timestamptz not null default now()
);

create unique index if not exists payment_events_provider_event_uniq
  on payment_events (provider, event_id);

comment on table payment_events is
  'Every webhook the provider sends, recorded before it is acted on. The unique index is the idempotency guard.';

-- --- only a succeeded payment counts ----------------------------------------

-- Replaces the version in 0002. A pending or failed card payment must not move
-- an invoice towards paid.
create or replace function recalc_invoice_payments(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv invoices%rowtype;
  received bigint;
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  select * into inv from invoices where id = p_invoice;
  if inv.id is null then return; end if;

  select coalesce(sum(amount_cents - refunded_cents), 0)
    into received
    from payments
   where invoice_id = p_invoice
     and deleted_at is null
     and status = 'succeeded';

  update invoices
     set paid_cents = received,
         paid_at = case when received >= inv.total_cents and inv.total_cents > 0
                        then coalesce(inv.paid_at, now()) else null end,
         status = case
           when inv.status in ('draft', 'cancelled') then inv.status
           when received <= 0 then
             case when inv.due_date is not null and inv.due_date < today then 'overdue'::invoice_status
                  when inv.viewed_at is not null then 'viewed'::invoice_status
                  else 'sent'::invoice_status end
           when received < inv.total_cents then 'partially_paid'::invoice_status
           else 'paid'::invoice_status
         end
   where id = p_invoice;
end $$;

-- The `payments_recalc` trigger from 0002 already calls this on every insert,
-- update and delete, so replacing the function above is the whole change: a
-- payment moving from pending to succeeded now re-runs it.

-- --- who is this customer? --------------------------------------------------

-- The customer equivalent of app_business_ids(). Definer, pinned search_path,
-- and scoped to auth.uid() — a signed-out caller gets nothing.
create or replace function app_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cu.customer_id
  from customer_users cu
  where cu.user_id = auth.uid()
    and cu.deleted_at is null
    and cu.accepted_at is not null;
$$;

create or replace function app_is_customer(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target is not null and target in (select app_customer_ids());
$$;

grant execute on function app_customer_ids() to authenticated;
grant execute on function app_is_customer(uuid) to authenticated;

-- --- accepting a customer invitation ----------------------------------------

create or replace function accept_customer_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  link customer_users%rowtype;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into link from customer_users
   where invite_token = p_token and deleted_at is null;

  if link.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if link.accepted_at is not null and link.user_id is distinct from uid then
    raise exception 'invitation already used' using errcode = '42501';
  end if;

  update customer_users
     set user_id = uid,
         accepted_at = coalesce(accepted_at, now()),
         invite_token = null,
         last_seen_at = now()
   where id = link.id;

  return link.customer_id;
end $$;

grant execute on function accept_customer_invite(text) to authenticated;

-- ===========================================================================
-- Policies
--
-- Customer access is added as an extra clause on the SELECT policies of the
-- records a customer is entitled to see. Every staff clause is unchanged.
-- ===========================================================================

alter table customer_users enable row level security;
alter table customer_users force row level security;
alter table payment_events enable row level security;
alter table payment_events force row level security;

-- A business manages its own customer logins; a customer sees their own link.
drop policy if exists customer_users_select on customer_users;
create policy customer_users_select on customer_users for select to authenticated
  using (app_is_member(business_id) or user_id = auth.uid());

drop policy if exists customer_users_insert on customer_users;
create policy customer_users_insert on customer_users for insert to authenticated
  with check (app_has_role(business_id, app_managers()));

drop policy if exists customer_users_update on customer_users;
create policy customer_users_update on customer_users for update to authenticated
  using (app_has_role(business_id, app_managers()) or user_id = auth.uid())
  with check (app_has_role(business_id, app_managers()) or user_id = auth.uid());

drop policy if exists customer_users_delete on customer_users;
create policy customer_users_delete on customer_users for delete to authenticated
  using (app_has_role(business_id, app_admins()));

-- Provider events are written by the webhook with the service role and read by
-- management. Nothing a customer can reach.
drop policy if exists payment_events_select on payment_events;
create policy payment_events_select on payment_events for select to authenticated
  using (business_id is not null and app_has_role(business_id, app_admins()));

-- --- what a signed-in customer may read -------------------------------------

drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select to authenticated
  using (app_is_member(business_id) or app_is_customer(customer_id));

drop policy if exists reports_select on reports;
create policy reports_select on reports for select to authenticated
  using (
    app_is_member(business_id)
    -- Only once it has been sent. A draft report is the business's working
    -- copy and is not the customer's to read.
    or (app_is_customer(customer_id) and sent_at is not null)
  );

drop policy if exists report_photos_select on report_photos;
create policy report_photos_select on report_photos for select to authenticated
  using (
    app_is_member(business_id)
    or exists (
      select 1 from reports r
      where r.id = report_photos.report_id
        and r.sent_at is not null
        and app_is_customer(r.customer_id)
    )
  );

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or (app_is_customer(customer_id) and status <> 'draft')
  );

drop policy if exists invoice_items_select on invoice_items;
create policy invoice_items_select on invoice_items for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or exists (
      select 1 from invoices i
      where i.id = invoice_items.invoice_id
        and i.status <> 'draft'
        and app_is_customer(i.customer_id)
    )
  );

drop policy if exists quotes_select on quotes;
create policy quotes_select on quotes for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or (app_is_customer(customer_id) and status <> 'draft')
  );

drop policy if exists quote_items_select on quote_items;
create policy quote_items_select on quote_items for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or exists (
      select 1 from quotes q
      where q.id = quote_items.quote_id
        and q.status <> 'draft'
        and app_is_customer(q.customer_id)
    )
  );

drop policy if exists payments_select on payments;
create policy payments_select on payments for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or app_is_customer(customer_id)
  );

-- A customer sees their own record, so the portal can greet them and show the
-- address a report was sent to. Never another customer's, in any business.
drop policy if exists customers_select on customers;
create policy customers_select on customers for select to authenticated
  using (app_is_member(business_id) or app_is_customer(id));

-- Notifications already scope to `user_id = auth.uid()`, which covers a
-- customer without any change.

-- --- the customer's copy of a report, without an account --------------------

create or replace function public_report_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r reports%rowtype;
  b businesses%rowtype;
  c customers%rowtype;
  j jobs%rowtype;
begin
  if p_token is null or length(p_token) < 20 then
    return null;
  end if;

  select * into r from reports
   where share_token = p_token and deleted_at is null and sent_at is not null;
  if r.id is null then return null; end if;

  select * into b from businesses where id = r.business_id;
  select * into c from customers where id = r.customer_id;
  select * into j from jobs where id = r.job_id;

  if r.viewed_at is null then
    update reports set viewed_at = now() where id = r.id;
    insert into activities (business_id, verb, summary, entity_type, entity_id, job_id, customer_id)
    values (r.business_id, 'viewed', 'Report ' || r.number || ' opened by the customer',
            'report', r.id, r.job_id, r.customer_id);
    r.viewed_at := now();
  end if;

  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', r.id, 'number', r.number, 'title', r.title, 'report_date', r.report_date,
      'status', r.status, 'summary', r.summary, 'data', r.data,
      'signature_name', r.signature_name, 'sent_at', r.sent_at, 'viewed_at', r.viewed_at
    ),
    'business', jsonb_build_object(
      'name', b.name, 'abn', b.abn, 'email', b.email, 'phone', b.phone,
      'address_line1', b.address_line1, 'suburb', b.suburb, 'state', b.state,
      'postcode', b.postcode, 'logo_path', b.logo_path
    ),
    'customer', jsonb_build_object('name', c.name, 'company', c.company),
    'job', case when j.id is null then null
                else jsonb_build_object('number', j.number, 'name', j.name,
                                        'site_address_line1', j.site_address_line1,
                                        'site_suburb', j.site_suburb) end,
    -- report_photos is a join table; the file itself lives on job_photos.
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'caption', coalesce(rp.caption, jp.caption),
               'storage_path', jp.storage_path,
               'taken_at', jp.taken_at
             ) order by rp.position)
        from report_photos rp
        join job_photos jp on jp.id = rp.photo_id and jp.deleted_at is null
       where rp.report_id = r.id
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public_report_by_token(text) to anon, authenticated;

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
