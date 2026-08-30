-- ===========================================================================
-- 0001_schema.sql — TradeFlow core schema
--
-- Multi-tenant. `businesses` is the tenant root; every other business-owned
-- table carries a non-null `business_id` so that one row-level-security
-- predicate ("is the caller a member of this business?") covers the whole
-- database. 0002_rls.sql applies that predicate; nothing here is reachable
-- until it does.
--
-- Money is stored as integer cents in bigint columns. Nothing in this schema
-- or in the application ever holds a monetary amount in a float.
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- --- enumerations ----------------------------------------------------------

do $$ begin
  create type team_role as enum ('owner', 'admin', 'manager', 'worker', 'accountant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_status as enum (
    'lead', 'estimating', 'quote_sent', 'accepted', 'scheduled',
    'in_progress', 'on_hold', 'completed', 'invoiced', 'paid', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_status as enum ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estimate_status as enum ('draft', 'ready', 'converted', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quote_status as enum (
    'draft', 'sent', 'viewed', 'accepted', 'declined', 'changes_requested', 'expired', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum (
    'draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('open', 'in_progress', 'completed', 'verified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cost_kind as enum (
    'labour', 'materials', 'equipment', 'travel', 'subcontractor', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('draft', 'final', 'sent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_state as enum ('draft', 'queued', 'sent', 'failed', 'received');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mailbox_provider as enum ('google', 'microsoft', 'imap');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum (
    'bank_transfer', 'card', 'cash', 'cheque', 'direct_debit', 'other'
  );
exception when duplicate_object then null; end $$;

-- --- tenants ---------------------------------------------------------------

create table if not exists businesses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 1 and 200),
  business_type       text,
  abn                 text check (abn is null or abn ~ '^[0-9]{11}$'),
  email               citext,
  phone               text,
  address_line1       text,
  address_line2       text,
  suburb              text,
  state               text,
  postcode            text,
  country             text not null default 'AU',
  logo_path           text,
  gst_registered      boolean not null default true,
  default_payment_terms_days integer not null default 14 check (default_payment_terms_days between 0 and 365),
  quote_validity_days integer not null default 30 check (quote_validity_days between 1 and 365),
  default_markup_bp   integer not null default 1500 check (default_markup_bp between 0 and 100000),
  bank_account_name   text,
  bank_bsb            text,
  bank_account_number text,
  plan                text not null default 'free' check (plan in ('free', 'pro', 'business')),
  is_demo             boolean not null default false,
  onboarded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- Mirrors auth.users. Kept separate so the app can read display names without
-- ever being granted read access to the auth schema.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        citext not null,
  full_name    text,
  phone        text,
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists team_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  role         team_role not null default 'worker',
  full_name    text,
  email        citext not null,
  phone        text,
  hourly_rate_cents bigint check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  invite_token text unique,
  invited_at   timestamptz,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists team_members_business_user_uniq
  on team_members (business_id, user_id) where user_id is not null and deleted_at is null;
create unique index if not exists team_members_business_email_uniq
  on team_members (business_id, email) where deleted_at is null;
create index if not exists team_members_user_idx on team_members (user_id) where deleted_at is null;

-- Per-business document numbering (JOB-0001, QUO-0007, INV-0031, ...).
create table if not exists number_sequences (
  business_id  uuid not null references businesses(id) on delete cascade,
  kind         text not null check (kind in ('job', 'estimate', 'quote', 'invoice', 'report', 'expense')),
  prefix       text not null,
  next_value   integer not null default 1 check (next_value > 0),
  padding      integer not null default 4 check (padding between 1 and 10),
  primary key (business_id, kind)
);

-- --- CRM -------------------------------------------------------------------

create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  company       text,
  email         citext,
  phone         text,
  abn           text,
  contact_person text,
  address_line1 text,
  address_line2 text,
  suburb        text,
  state         text,
  postcode      text,
  country       text not null default 'AU',
  notes         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists customers_business_idx on customers (business_id) where deleted_at is null;
create index if not exists customers_name_idx on customers (business_id, lower(name)) where deleted_at is null;

create table if not exists contacts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  name         text not null,
  role         text,
  email        citext,
  phone        text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists contacts_customer_idx on contacts (customer_id) where deleted_at is null;

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  customer_id   uuid references customers(id) on delete set null,
  name          text not null,
  company       text,
  email         citext,
  phone         text,
  source        text,
  description   text,
  status        lead_status not null default 'new',
  estimated_value_cents bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  site_address  text,
  next_follow_up_at date,
  lost_reason   text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists leads_business_status_idx on leads (business_id, status) where deleted_at is null;

-- --- suppliers & materials -------------------------------------------------

create table if not exists suppliers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  contact_person text,
  email        citext,
  phone        text,
  address      text,
  account_number text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists suppliers_business_idx on suppliers (business_id) where deleted_at is null;

create table if not exists materials (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  supplier_id    uuid references suppliers(id) on delete set null,
  sku            text,
  name           text not null,
  description    text,
  unit           text not null default 'each',
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  taxable        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists materials_business_idx on materials (business_id) where deleted_at is null;
create unique index if not exists materials_business_sku_uniq
  on materials (business_id, lower(sku)) where sku is not null and deleted_at is null;

-- --- jobs ------------------------------------------------------------------

create table if not exists jobs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  lead_id        uuid references leads(id) on delete set null,
  number         text not null,
  name           text not null check (length(btrim(name)) between 1 and 200),
  description    text,
  site_address_line1 text,
  site_suburb    text,
  site_state     text,
  site_postcode  text,
  status         job_status not null default 'lead',
  start_date     date,
  expected_completion_date date,
  completed_at   timestamptz,
  budget_cents   bigint check (budget_cents is null or budget_cents >= 0),
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint jobs_dates_ordered check (
    expected_completion_date is null or start_date is null
    or expected_completion_date >= start_date
  )
);
create unique index if not exists jobs_business_number_uniq on jobs (business_id, number);
create index if not exists jobs_business_status_idx on jobs (business_id, status) where deleted_at is null;
create index if not exists jobs_customer_idx on jobs (customer_id) where deleted_at is null;

create table if not exists job_assignments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  job_id         uuid not null references jobs(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  created_at     timestamptz not null default now()
);
create unique index if not exists job_assignments_uniq on job_assignments (job_id, team_member_id);

create table if not exists job_tasks (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  email_id       uuid,
  report_id      uuid,
  title          text not null check (length(btrim(title)) between 1 and 300),
  description    text,
  priority       task_priority not null default 'medium',
  status         task_status not null default 'open',
  assigned_to    uuid references team_members(id) on delete set null,
  due_date       date,
  completed_at   timestamptz,
  verified_at    timestamptz,
  verified_by    uuid references team_members(id) on delete set null,
  source         text not null default 'manual'
                 check (source in ('manual', 'email', 'report', 'defect', 'customer_request', 'ai')),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists job_tasks_business_status_idx on job_tasks (business_id, status) where deleted_at is null;
create index if not exists job_tasks_due_idx on job_tasks (business_id, due_date) where deleted_at is null;
create index if not exists job_tasks_job_idx on job_tasks (job_id) where deleted_at is null;

create table if not exists job_notes (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  body         text not null check (length(btrim(body)) > 0),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists job_notes_job_idx on job_notes (job_id) where deleted_at is null;

-- --- estimates -------------------------------------------------------------

create table if not exists estimates (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  job_id            uuid references jobs(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  number            text not null,
  title             text not null,
  notes             text,
  status            estimate_status not null default 'draft',
  markup_bp         integer not null default 1500 check (markup_bp between 0 and 100000),
  contingency_bp    integer not null default 0 check (contingency_bp between 0 and 100000),
  gst_bp            integer not null default 1000 check (gst_bp between 0 and 10000),
  gst_applies       boolean not null default true,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists estimates_business_number_uniq on estimates (business_id, number);
create index if not exists estimates_business_idx on estimates (business_id) where deleted_at is null;

create table if not exists estimate_items (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  estimate_id       uuid not null references estimates(id) on delete cascade,
  kind              cost_kind not null default 'materials',
  description       text not null check (length(btrim(description)) > 0),
  quantity_milli    bigint not null default 1000 check (quantity_milli >= 0),
  unit              text not null default 'each',
  unit_cost_cents   bigint not null default 0 check (unit_cost_cents >= 0),
  taxable           boolean not null default true,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists estimate_items_estimate_idx on estimate_items (estimate_id, position);

-- --- quotes ----------------------------------------------------------------

create table if not exists quotes (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  estimate_id       uuid references estimates(id) on delete set null,
  job_id            uuid references jobs(id) on delete set null,
  customer_id       uuid not null references customers(id) on delete restrict,
  number            text not null,
  version           integer not null default 1 check (version > 0),
  status            quote_status not null default 'draft',
  title             text not null,
  scope_of_work     text,
  terms             text,
  payment_terms     text,
  issue_date        date not null default (now() at time zone 'Australia/Sydney')::date,
  expiry_date       date,
  gst_bp            integer not null default 1000 check (gst_bp between 0 and 10000),
  gst_applies       boolean not null default true,
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  -- Denormalised totals, recomputed by trigger from quote_items. Kept on the
  -- row so lists and dashboards do not have to aggregate line items.
  subtotal_cents    bigint not null default 0,
  tax_cents         bigint not null default 0,
  total_cents       bigint not null default 0,
  share_token       text unique,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  accepted_at       timestamptz,
  declined_at       timestamptz,
  decline_reason    text,
  customer_message  text,
  accepted_by_name  text,
  accepted_ip       inet,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists quotes_business_number_version_uniq on quotes (business_id, number, version);
create index if not exists quotes_business_status_idx on quotes (business_id, status) where deleted_at is null;
create index if not exists quotes_customer_idx on quotes (customer_id) where deleted_at is null;

create table if not exists quote_items (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  quote_id          uuid not null references quotes(id) on delete cascade,
  description       text not null check (length(btrim(description)) > 0),
  detail            text,
  quantity_milli    bigint not null default 1000 check (quantity_milli >= 0),
  unit              text not null default 'each',
  unit_price_cents  bigint not null default 0,
  taxable           boolean not null default true,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists quote_items_quote_idx on quote_items (quote_id, position);

-- Immutable snapshot of a quote each time it is sent, so "what did the
-- customer actually see" survives later edits.
create table if not exists quote_versions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  quote_id     uuid not null references quotes(id) on delete cascade,
  version      integer not null,
  snapshot     jsonb not null,
  total_cents  bigint not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists quote_versions_uniq on quote_versions (quote_id, version);

-- --- invoices --------------------------------------------------------------

create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  quote_id          uuid references quotes(id) on delete set null,
  job_id            uuid references jobs(id) on delete set null,
  customer_id       uuid not null references customers(id) on delete restrict,
  number            text not null,
  status            invoice_status not null default 'draft',
  title             text,
  issue_date        date not null default (now() at time zone 'Australia/Sydney')::date,
  due_date          date,
  payment_terms     text,
  notes             text,
  bank_details      text,
  gst_bp            integer not null default 1000 check (gst_bp between 0 and 10000),
  gst_applies       boolean not null default true,
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  subtotal_cents    bigint not null default 0,
  tax_cents         bigint not null default 0,
  total_cents       bigint not null default 0,
  paid_cents        bigint not null default 0,
  share_token       text unique,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  paid_at           timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists invoices_business_number_uniq on invoices (business_id, number);
create index if not exists invoices_business_status_idx on invoices (business_id, status) where deleted_at is null;
create index if not exists invoices_due_idx on invoices (business_id, due_date) where deleted_at is null;

create table if not exists invoice_items (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  invoice_id        uuid not null references invoices(id) on delete cascade,
  description       text not null check (length(btrim(description)) > 0),
  detail            text,
  quantity_milli    bigint not null default 1000 check (quantity_milli >= 0),
  unit              text not null default 'each',
  unit_price_cents  bigint not null default 0,
  taxable           boolean not null default true,
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on invoice_items (invoice_id, position);

create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  invoice_id     uuid not null references invoices(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  amount_cents   bigint not null check (amount_cents > 0),
  method         payment_method not null default 'bank_transfer',
  reference      text,
  paid_on        date not null default (now() at time zone 'Australia/Sydney')::date,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists payments_invoice_idx on payments (invoice_id) where deleted_at is null;

-- --- expenses --------------------------------------------------------------

create table if not exists expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  job_id         uuid references jobs(id) on delete set null,
  supplier_id    uuid references suppliers(id) on delete set null,
  category       cost_kind not null default 'materials',
  description    text not null check (length(btrim(description)) > 0),
  amount_cents   bigint not null check (amount_cents >= 0),
  gst_cents      bigint not null default 0 check (gst_cents >= 0),
  spent_on       date not null default (now() at time zone 'Australia/Sydney')::date,
  reference      text,
  receipt_path   text,
  billable       boolean not null default false,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists expenses_business_date_idx on expenses (business_id, spent_on) where deleted_at is null;
create index if not exists expenses_job_idx on expenses (job_id) where deleted_at is null;

-- --- work logs -------------------------------------------------------------

create table if not exists work_logs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  job_id             uuid not null references jobs(id) on delete cascade,
  work_date          date not null default (now() at time zone 'Australia/Sydney')::date,
  start_time         time,
  finish_time        time,
  break_minutes      integer not null default 0 check (break_minutes >= 0),
  -- Derived from start/finish/break by trigger; stored so reports can sum it.
  total_minutes      integer not null default 0 check (total_minutes >= 0),
  worker_count       integer not null default 1 check (worker_count >= 0),
  work_completed     text,
  materials_used     text,
  equipment_used     text,
  weather            text,
  problems           text,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists work_logs_job_date_idx on work_logs (job_id, work_date) where deleted_at is null;

create table if not exists work_log_workers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  work_log_id    uuid not null references work_logs(id) on delete cascade,
  team_member_id uuid references team_members(id) on delete set null,
  name           text not null,
  minutes        integer not null default 0 check (minutes >= 0),
  created_at     timestamptz not null default now()
);
create index if not exists work_log_workers_log_idx on work_log_workers (work_log_id);

-- --- reports ---------------------------------------------------------------

create table if not exists report_templates (
  id           uuid primary key default gen_random_uuid(),
  -- Null business_id marks a system template, readable by every tenant and
  -- writable by none.
  business_id  uuid references businesses(id) on delete cascade,
  key          text not null,
  name         text not null,
  description  text,
  sections     jsonb not null default '[]'::jsonb,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists report_templates_system_key_uniq
  on report_templates (key) where business_id is null;
create unique index if not exists report_templates_business_key_uniq
  on report_templates (business_id, key) where business_id is not null and deleted_at is null;

create table if not exists reports (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  template_id   uuid references report_templates(id) on delete set null,
  template_key  text not null default 'daily_site',
  job_id        uuid references jobs(id) on delete set null,
  customer_id   uuid references customers(id) on delete set null,
  number        text not null,
  title         text not null,
  report_date   date not null default (now() at time zone 'Australia/Sydney')::date,
  status        report_status not null default 'draft',
  -- Answers keyed by section field id. Templates evolve; historical reports
  -- keep whatever they were filled in with.
  data          jsonb not null default '{}'::jsonb,
  summary       text,
  signature_name text,
  signature_path text,
  signed_at     timestamptz,
  sent_at       timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index if not exists reports_business_number_uniq on reports (business_id, number);
create index if not exists reports_business_date_idx on reports (business_id, report_date) where deleted_at is null;
create index if not exists reports_job_idx on reports (job_id) where deleted_at is null;

-- --- photos & documents ----------------------------------------------------

create table if not exists job_photos (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  job_id        uuid references jobs(id) on delete cascade,
  report_id     uuid references reports(id) on delete set null,
  work_log_id   uuid references work_logs(id) on delete set null,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null default 'image/jpeg',
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  width         integer,
  height        integer,
  caption       text,
  category      text not null default 'general'
                check (category in ('general', 'before', 'during', 'after', 'defect', 'safety', 'compliance', 'damage')),
  taken_at      timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists job_photos_job_idx on job_photos (job_id) where deleted_at is null;
create index if not exists job_photos_report_idx on job_photos (report_id) where deleted_at is null;

-- Photos attached to a report in a chosen order, for the photo report PDF.
create table if not exists report_photos (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  report_id    uuid not null references reports(id) on delete cascade,
  photo_id     uuid not null references job_photos(id) on delete cascade,
  position     integer not null default 0,
  caption      text,
  created_at   timestamptz not null default now()
);
create unique index if not exists report_photos_uniq on report_photos (report_id, photo_id);

create table if not exists job_documents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  job_id        uuid references jobs(id) on delete cascade,
  customer_id   uuid references customers(id) on delete cascade,
  quote_id      uuid references quotes(id) on delete cascade,
  invoice_id    uuid references invoices(id) on delete cascade,
  report_id     uuid references reports(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  category      text not null default 'general',
  description   text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists job_documents_business_idx on job_documents (business_id) where deleted_at is null;
create index if not exists job_documents_job_idx on job_documents (job_id) where deleted_at is null;

-- --- email -----------------------------------------------------------------

create table if not exists email_accounts (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  provider          mailbox_provider not null,
  email_address     citext not null,
  display_name      text,
  -- Encrypted at rest with TOKEN_ENCRYPTION_KEY before it reaches the row;
  -- the column never holds a readable token.
  refresh_token_enc text,
  access_token_enc  text,
  token_expires_at  timestamptz,
  scopes            text[],
  history_cursor    text,
  last_synced_at    timestamptz,
  sync_error        text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists email_accounts_business_address_uniq
  on email_accounts (business_id, email_address) where deleted_at is null;

create table if not exists email_threads (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  email_account_id  uuid references email_accounts(id) on delete set null,
  provider_thread_id text,
  subject           text,
  snippet           text,
  customer_id       uuid references customers(id) on delete set null,
  job_id            uuid references jobs(id) on delete set null,
  quote_id          uuid references quotes(id) on delete set null,
  invoice_id        uuid references invoices(id) on delete set null,
  participants      text[] not null default '{}',
  message_count     integer not null default 0,
  is_read           boolean not null default false,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists email_threads_business_idx on email_threads (business_id, last_message_at desc) where deleted_at is null;
create index if not exists email_threads_job_idx on email_threads (job_id) where deleted_at is null;
create unique index if not exists email_threads_provider_uniq
  on email_threads (email_account_id, provider_thread_id) where provider_thread_id is not null;

create table if not exists emails (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  thread_id         uuid references email_threads(id) on delete cascade,
  email_account_id  uuid references email_accounts(id) on delete set null,
  provider_message_id text,
  direction         email_direction not null,
  state             email_state not null default 'draft',
  from_address      citext not null,
  from_name         text,
  to_addresses      text[] not null default '{}',
  cc_addresses      text[] not null default '{}',
  bcc_addresses     text[] not null default '{}',
  subject           text,
  body_text         text,
  body_html         text,
  snippet           text,
  customer_id       uuid references customers(id) on delete set null,
  job_id            uuid references jobs(id) on delete set null,
  quote_id          uuid references quotes(id) on delete set null,
  invoice_id        uuid references invoices(id) on delete set null,
  report_id         uuid references reports(id) on delete set null,
  is_read           boolean not null default false,
  ai_summary        text,
  ai_actions        jsonb,
  error             text,
  sent_at           timestamptz,
  received_at       timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists emails_business_idx on emails (business_id, created_at desc) where deleted_at is null;
create index if not exists emails_thread_idx on emails (thread_id, created_at) where deleted_at is null;
create index if not exists emails_job_idx on emails (job_id) where deleted_at is null;
create unique index if not exists emails_provider_uniq
  on emails (email_account_id, provider_message_id) where provider_message_id is not null;

create table if not exists email_attachments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  email_id      uuid not null references emails(id) on delete cascade,
  document_id   uuid references job_documents(id) on delete set null,
  storage_path  text,
  file_name     text not null,
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null default 0 check (size_bytes >= 0),
  -- Attachments generated on the fly (a quote PDF, an invoice PDF) reference
  -- the source record instead of a stored file.
  generated_kind text check (generated_kind in ('quote', 'invoice', 'report')),
  generated_id  uuid,
  created_at    timestamptz not null default now()
);
create index if not exists email_attachments_email_idx on email_attachments (email_id);

-- --- notifications, activity, audit ---------------------------------------

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  severity     text not null default 'info' check (severity in ('info', 'success', 'warning', 'danger')),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (business_id, user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (business_id, user_id) where read_at is null;

-- The human-readable timeline shown on jobs, customers, quotes and invoices.
create table if not exists activities (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_label   text,
  verb          text not null,
  summary       text not null,
  entity_type   text not null,
  entity_id     uuid,
  job_id        uuid references jobs(id) on delete cascade,
  customer_id   uuid references customers(id) on delete cascade,
  quote_id      uuid references quotes(id) on delete cascade,
  invoice_id    uuid references invoices(id) on delete cascade,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists activities_business_idx on activities (business_id, created_at desc);
create index if not exists activities_job_idx on activities (job_id, created_at desc);
create index if not exists activities_customer_idx on activities (customer_id, created_at desc);
create index if not exists activities_entity_idx on activities (entity_type, entity_id);

-- Append-only. No update or delete policy is ever granted on this table.
create table if not exists audit_logs (
  id            bigserial primary key,
  business_id   uuid references businesses(id) on delete set null,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_email   text,
  action        text not null,
  entity_type   text,
  entity_id     uuid,
  outcome       text not null default 'allowed' check (outcome in ('allowed', 'denied', 'error')),
  ip_address    inet,
  user_agent    text,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_logs_business_idx on audit_logs (business_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs (action, created_at desc);

-- Cross-references declared after their targets exist.
do $$ begin
  alter table job_tasks add constraint job_tasks_email_fk
    foreign key (email_id) references emails(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table job_tasks add constraint job_tasks_report_fk
    foreign key (report_id) references reports(id) on delete set null;
exception when duplicate_object then null; end $$;
