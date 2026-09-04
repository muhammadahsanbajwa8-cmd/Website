-- ===========================================================================
-- 0010 — the customer's own account
--
-- 0007 gave a customer a login and let them read the documents addressed to
-- them. This gives them somewhere to go: a portal with their bookings, the
-- work a business offers, the reports written about their job, what they owe,
-- and a way to talk to the business without picking up the phone.
--
-- Three new things, one changed thing, and a deliberate tightening.
--
--   new       `services`   — what a business offers. Nothing modelled it
--                            before; a customer asking for work had to
--                            describe it from scratch.
--             `messages`   — a thread between one customer and one business.
--                            Not email: email is for the outside world, this
--                            is for people who are signed in.
--             portal_*()   — definer functions the portal reads and writes
--                            through, each scoped to auth.uid().
--
--   changed   `leads`      — a request made from the portal is a lead, with
--                            the service asked for and when they would like
--                            it. Reusing leads means a portal request lands
--                            in the business's existing pipeline rather than
--                            in a parallel inbox nobody checks.
--
--   tightened `customers` and `jobs` — 0007 let a signed-in customer read
--             their own row on both tables. Both carry a `notes` column that
--             is the business's working note, not the customer's to read. The
--             clause is withdrawn and the portal reads through
--             `portal_links()` / `portal_jobs()` instead, which return the
--             fields a customer is entitled to and no others.
-- ===========================================================================

-- --- who a customer is, and to whom -----------------------------------------

create or replace function app_customer_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cu.business_id
  from customer_users cu
  where cu.user_id = auth.uid()
    and cu.deleted_at is null
    and cu.accepted_at is not null;
$$;

-- Both halves at once: this customer, at this business. Used by every write a
-- customer is allowed to make, so a row can never be planted under one
-- business with another business's customer id.
create or replace function app_is_customer_of(p_customer uuid, p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from customer_users cu
    where cu.user_id = auth.uid()
      and cu.customer_id = p_customer
      and cu.business_id = p_business
      and cu.deleted_at is null
      and cu.accepted_at is not null
  );
$$;

grant execute on function app_customer_business_ids() to authenticated;
grant execute on function app_is_customer_of(uuid, uuid) to authenticated;

-- --- what a business offers --------------------------------------------------

create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 120),
  description      text,
  -- "From $180" — a guide, not a quote. Null means "ask us".
  price_from_cents bigint check (price_from_cents is null or price_from_cents >= 0),
  price_note       text,
  lead_time        text,
  is_active        boolean not null default true,
  position         integer not null default 0,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index if not exists services_business_idx
  on services (business_id, position) where deleted_at is null;

comment on table services is
  'The work a business will take on, shown to its customers in the portal. Every field here is meant to be read by a customer.';

-- --- talking to each other ---------------------------------------------------

create table if not exists messages (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references businesses(id) on delete cascade,
  customer_id          uuid not null references customers(id) on delete cascade,
  job_id               uuid references jobs(id) on delete set null,
  sender               text not null check (sender in ('customer', 'business')),
  author_id            uuid references auth.users(id) on delete set null,
  author_label         text,
  body                 text not null check (length(btrim(body)) between 1 and 5000),
  read_by_business_at  timestamptz,
  read_by_customer_at  timestamptz,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists messages_thread_idx
  on messages (business_id, customer_id, created_at desc) where deleted_at is null;

comment on table messages is
  'One thread per customer per business. Both sides write to it; neither side can edit what the other wrote.';

-- --- a request made from the portal -----------------------------------------

alter table leads
  add column if not exists service_id uuid references services(id) on delete set null,
  add column if not exists preferred_date date,
  add column if not exists preferred_window text;

comment on column leads.preferred_date is
  'When the customer would like the work done. A wish, not a booking — the business still schedules it.';

-- ===========================================================================
-- Policies
-- ===========================================================================

alter table services enable row level security;
alter table services force row level security;
alter table messages enable row level security;
alter table messages force row level security;

-- A business writes its own list; its customers read the live entries.
drop policy if exists services_select on services;
create policy services_select on services for select to authenticated
  using (
    app_is_member(business_id)
    or (is_active and deleted_at is null and business_id in (select app_customer_business_ids()))
  );

drop policy if exists services_insert on services;
create policy services_insert on services for insert to authenticated
  with check (app_has_role(business_id, app_managers()));

drop policy if exists services_update on services;
create policy services_update on services for update to authenticated
  using (app_has_role(business_id, app_managers()))
  with check (app_has_role(business_id, app_managers()));

drop policy if exists services_delete on services;
create policy services_delete on services for delete to authenticated
  using (app_has_role(business_id, app_admins()));

-- Either side of the thread reads it.
drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated
  using (app_is_member(business_id) or app_is_customer(customer_id));

-- And writes only as themselves. A customer cannot post as the business, and
-- the customer id has to be one of theirs at that same business.
drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert to authenticated
  with check (
    (sender = 'business' and app_is_member(business_id))
    or (sender = 'customer' and author_id = auth.uid() and app_is_customer_of(customer_id, business_id))
  );

-- Marking a message read is the only edit. Nobody rewrites what was said:
-- a business may touch the business-side flag, a customer the customer-side
-- one, and the portal does the latter through portal_mark_messages_read().
drop policy if exists messages_update on messages;
create policy messages_update on messages for update to authenticated
  using (app_is_member(business_id))
  with check (app_is_member(business_id));

drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete to authenticated
  using (app_has_role(business_id, app_admins()));

-- --- a customer reads their own notifications --------------------------------
-- The old policy required membership of the business, which no customer has.
-- Own notifications, always; the business-wide ones (user_id null) still need
-- membership.
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (user_id = auth.uid() or (app_is_member(business_id) and user_id is null));

-- --- the tightening ----------------------------------------------------------
-- Withdrawn: the clause 0007 added for a signed-in customer. Both tables carry
-- a `notes` column written by staff about the customer, and a policy cannot
-- hide a column. The portal reads these through the definer functions below,
-- which return names and addresses and no working notes.

drop policy if exists customers_select on customers;
create policy customers_select on customers for select to authenticated
  using (app_is_member(business_id));

drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select to authenticated
  using (app_is_member(business_id));

-- ===========================================================================
-- The portal's own reads and writes
--
-- Every one of these is `security definer` with a pinned search_path, and
-- every one starts from auth.uid(). Passing another customer's id returns
-- nothing; there is no argument that widens what the caller can see.
-- ===========================================================================

-- Who am I, and which businesses know me?
create or replace function portal_links()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(link order by link->>'business_name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'link_id', cu.id,
      'customer_id', c.id,
      'business_id', b.id,
      'customer_name', c.name,
      'customer_company', c.company,
      'customer_email', c.email,
      'customer_phone', c.phone,
      'customer_address_line1', c.address_line1,
      'customer_address_line2', c.address_line2,
      'customer_suburb', c.suburb,
      'customer_state', c.state,
      'customer_postcode', c.postcode,
      'business_name', b.name,
      'business_email', b.email,
      'business_phone', b.phone,
      'business_abn', b.abn,
      'business_logo_path', b.logo_path,
      'business_suburb', b.suburb,
      'business_state', b.state,
      'accepts_cards', b.stripe_charges_enabled
    ) as link
    from customer_users cu
    join customers c on c.id = cu.customer_id and c.deleted_at is null
    join businesses b on b.id = cu.business_id
    where cu.user_id = auth.uid()
      and cu.deleted_at is null
      and cu.accepted_at is not null
  ) links;
$$;

-- The customer's bookings. Their jobs, with the fields on a job that describe
-- the work rather than the office's opinion of it.
create or replace function portal_jobs(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(job order by job->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', j.id,
      'number', j.number,
      'name', j.name,
      'description', j.description,
      'status', j.status,
      'start_date', j.start_date,
      'expected_completion_date', j.expected_completion_date,
      'completed_at', j.completed_at,
      'site_address_line1', j.site_address_line1,
      'site_suburb', j.site_suburb,
      'site_state', j.site_state,
      'site_postcode', j.site_postcode,
      'created_at', j.created_at
    ) as job
    from jobs j
    where j.business_id = p_business
      and j.deleted_at is null
      and j.customer_id in (select app_customer_ids())
  ) jobs;
$$;

create or replace function portal_job(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j jobs%rowtype;
begin
  select * into j from jobs
   where id = p_job
     and deleted_at is null
     and customer_id in (select app_customer_ids());
  if j.id is null then return null; end if;

  return jsonb_build_object(
    'id', j.id,
    'business_id', j.business_id,
    'customer_id', j.customer_id,
    'number', j.number,
    'name', j.name,
    'description', j.description,
    'status', j.status,
    'start_date', j.start_date,
    'expected_completion_date', j.expected_completion_date,
    'completed_at', j.completed_at,
    'site_address_line1', j.site_address_line1,
    'site_suburb', j.site_suburb,
    'site_state', j.site_state,
    'site_postcode', j.site_postcode,
    'created_at', j.created_at,
    'assigned', coalesce((
      select jsonb_agg(distinct tm.full_name)
        from job_assignments ja
        join team_members tm on tm.id = ja.team_member_id
       where ja.job_id = j.id and tm.deleted_at is null and tm.full_name is not null
    ), '[]'::jsonb)
  );
end $$;

-- The requests this customer has made. `lost_reason` and the rest of the
-- pipeline's private thinking are not in the projection.
create or replace function portal_requests(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(req order by req->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', l.id,
      'description', l.description,
      'status', l.status,
      'site_address', l.site_address,
      'preferred_date', l.preferred_date,
      'preferred_window', l.preferred_window,
      'service_name', s.name,
      'created_at', l.created_at,
      'job_id', (select j.id from jobs j
                  where j.lead_id = l.id and j.deleted_at is null
                  order by j.created_at limit 1)
    ) as req
    from leads l
    left join services s on s.id = l.service_id
    where l.business_id = p_business
      and l.deleted_at is null
      and l.customer_id in (select app_customer_ids())
  ) requests;
$$;

-- Asking for work. Returns the new lead's id.
create or replace function portal_create_request(
  p_business uuid,
  p_customer uuid,
  p_service uuid,
  p_description text,
  p_preferred_date date,
  p_preferred_window text,
  p_site_address text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c customers%rowtype;
  s services%rowtype;
  new_id uuid;
begin
  if not app_is_customer_of(p_customer, p_business) then
    raise exception 'not your account' using errcode = '42501';
  end if;
  if p_description is null or length(btrim(p_description)) < 5 then
    raise exception 'tell us a little about the work' using errcode = '23514';
  end if;

  select * into c from customers where id = p_customer;

  if p_service is not null then
    select * into s from services
     where id = p_service and business_id = p_business and deleted_at is null and is_active;
    if s.id is null then
      raise exception 'that service is not offered' using errcode = 'P0002';
    end if;
  end if;

  insert into leads (
    business_id, customer_id, name, company, email, phone, source,
    description, status, site_address, service_id, preferred_date, preferred_window,
    created_by
  ) values (
    p_business, p_customer, c.name, c.company, c.email, c.phone, 'portal',
    btrim(p_description), 'new',
    coalesce(nullif(btrim(coalesce(p_site_address, '')), ''),
             nullif(btrim(concat_ws(', ', c.address_line1, c.suburb, c.state, c.postcode)), '')),
    s.id, p_preferred_date, nullif(btrim(coalesce(p_preferred_window, '')), ''),
    auth.uid()
  )
  returning id into new_id;

  insert into activities (business_id, actor_label, verb, summary, entity_type, entity_id, customer_id)
  values (p_business, c.name, 'requested',
          coalesce(s.name, 'Work') || ' requested by ' || c.name,
          'lead', new_id, p_customer);

  -- Everyone who works the pipeline hears about it.
  insert into notifications (business_id, user_id, kind, title, body, link, severity)
  select p_business, tm.user_id, 'lead.portal',
         'New request from ' || c.name,
         left(btrim(p_description), 160),
         '/leads/' || new_id::text,
         'info'
    from team_members tm
   where tm.business_id = p_business
     and tm.deleted_at is null
     and tm.user_id is not null
     and tm.role in ('owner', 'admin', 'manager');

  return new_id;
end $$;

-- Correcting their own contact details. Named columns only: a customer cannot
-- rename themselves onto another record, move business, or touch `notes`.
create or replace function portal_update_customer(
  p_customer uuid,
  p_email text,
  p_phone text,
  p_address_line1 text,
  p_address_line2 text,
  p_suburb text,
  p_state text,
  p_postcode text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  norm_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
begin
  if not app_is_customer(p_customer) then
    raise exception 'not your account' using errcode = '42501';
  end if;
  if norm_email is not null and norm_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'that email address does not look right' using errcode = '22P02';
  end if;

  update customers
     set email = coalesce(norm_email::citext, email),
         phone = nullif(btrim(coalesce(p_phone, '')), ''),
         address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
         address_line2 = nullif(btrim(coalesce(p_address_line2, '')), ''),
         suburb = nullif(btrim(coalesce(p_suburb, '')), ''),
         state = nullif(btrim(coalesce(p_state, '')), ''),
         postcode = nullif(btrim(coalesce(p_postcode, '')), ''),
         updated_at = now()
   where id = p_customer;
end $$;

create or replace function portal_mark_messages_read(p_business uuid, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_is_customer_of(p_customer, p_business) then
    raise exception 'not your account' using errcode = '42501';
  end if;
  update messages
     set read_by_customer_at = now()
   where business_id = p_business
     and customer_id = p_customer
     and sender = 'business'
     and read_by_customer_at is null;
end $$;

-- The share link for one of the customer's own documents.
--
-- A quote or an invoice reaches a customer by token: /q/<token> to read and
-- accept, /i/<token> to read and pay. Both pages, and the payment path behind
-- them, already exist and are the ones a customer who never signs in uses. So
-- the portal does not reimplement any of it — it asks for the token of a
-- document that is already theirs, minting one if the document was never
-- emailed, and hands them to the same page.
create or replace function portal_document_token(p_kind text, p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  token text;
begin
  if p_kind = 'invoice' then
    select share_token into token from invoices
     where id = p_id and deleted_at is null and status <> 'draft'
       and customer_id in (select app_customer_ids());
    if not found then return null; end if;
    if token is null then
      token := encode(gen_random_bytes(24), 'hex');
      update invoices set share_token = token where id = p_id;
    end if;
    return token;

  elsif p_kind = 'quote' then
    select share_token into token from quotes
     where id = p_id and deleted_at is null and status <> 'draft'
       and customer_id in (select app_customer_ids());
    if not found then return null; end if;
    if token is null then
      token := encode(gen_random_bytes(24), 'hex');
      update quotes set share_token = token where id = p_id;
    end if;
    return token;

  elsif p_kind = 'report' then
    select share_token into token from reports
     where id = p_id and deleted_at is null and sent_at is not null
       and customer_id in (select app_customer_ids());
    return token;
  end if;

  return null;
end $$;

-- The portal's own summary: one round trip for the home page.
create or replace function portal_summary(p_business uuid, p_customer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_is_customer_of(p_customer, p_business) then
    return null;
  end if;

  return jsonb_build_object(
    'open_requests', (
      select count(*) from leads
       where business_id = p_business and customer_id = p_customer
         and deleted_at is null and status in ('new', 'contacted', 'qualified', 'quoted')),
    'active_jobs', (
      select count(*) from jobs
       where business_id = p_business and customer_id = p_customer and deleted_at is null
         and status in ('accepted', 'scheduled', 'in_progress', 'on_hold')),
    'completed_jobs', (
      select count(*) from jobs
       where business_id = p_business and customer_id = p_customer and deleted_at is null
         and status = 'completed'),
    'next_visit', (
      select jsonb_build_object('id', j.id, 'number', j.number, 'name', j.name,
                                'start_date', j.start_date, 'status', j.status)
        from jobs j
       where j.business_id = p_business and j.customer_id = p_customer and j.deleted_at is null
         and j.start_date is not null
         and j.status in ('accepted', 'scheduled', 'in_progress')
       order by j.start_date
       limit 1),
    'amount_due_cents', coalesce((
      select sum(greatest(i.total_cents - i.paid_cents, 0)) from invoices i
       where i.business_id = p_business and i.customer_id = p_customer and i.deleted_at is null
         and i.status in ('sent', 'viewed', 'partially_paid', 'overdue')), 0),
    'overdue_cents', coalesce((
      select sum(greatest(i.total_cents - i.paid_cents, 0)) from invoices i
       where i.business_id = p_business and i.customer_id = p_customer and i.deleted_at is null
         and i.status = 'overdue'), 0),
    'paid_cents', coalesce((
      select sum(p.amount_cents - p.refunded_cents) from payments p
       where p.business_id = p_business and p.customer_id = p_customer and p.deleted_at is null
         and p.status = 'succeeded'), 0),
    'reports', (
      select count(*) from reports
       where business_id = p_business and customer_id = p_customer
         and deleted_at is null and sent_at is not null),
    'open_quotes', (
      select count(*) from quotes
       where business_id = p_business and customer_id = p_customer and deleted_at is null
         and status in ('sent', 'viewed')),
    'unread_messages', (
      select count(*) from messages
       where business_id = p_business and customer_id = p_customer and deleted_at is null
         and sender = 'business' and read_by_customer_at is null)
  );
end $$;

grant execute on function portal_links() to authenticated;
grant execute on function portal_jobs(uuid) to authenticated;
grant execute on function portal_job(uuid) to authenticated;
grant execute on function portal_requests(uuid) to authenticated;
grant execute on function portal_create_request(uuid, uuid, uuid, text, date, text, text) to authenticated;
grant execute on function portal_update_customer(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function portal_mark_messages_read(uuid, uuid) to authenticated;
grant execute on function portal_summary(uuid, uuid) to authenticated;
grant execute on function portal_document_token(text, uuid) to authenticated;

-- The two new tables, reachable at all (0009's grant was point-in-time).
grant select, insert, update, delete on services, messages to authenticated;
grant all on services, messages to service_role;
revoke all on services, messages from anon;

-- --- signing up from a customer invitation -----------------------------------
--
-- The team version of this has been in 0002 since the beginning: an invited
-- person signs up with the address they were invited at, and the invitation is
-- claimed for them. A customer invitation now works the same way, so somebody
-- who follows the link in their email and creates a password arrives already
-- attached to their account instead of at a second "accept" button.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(profiles.full_name, excluded.full_name);

  update team_members
     set user_id = new.id,
         accepted_at = coalesce(accepted_at, now()),
         full_name = coalesce(full_name, new.raw_user_meta_data->>'full_name')
   where user_id is null
     and deleted_at is null
     and email = new.email;

  update customer_users
     set user_id = new.id,
         accepted_at = coalesce(accepted_at, now()),
         invite_token = null
   where user_id is null
     and deleted_at is null
     and email = new.email;

  return new;
end;
$$;

-- --- prove it ---------------------------------------------------------------

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

  if has_table_privilege('anon', 'public.messages', 'SELECT')
     or has_table_privilege('anon', 'public.services', 'SELECT') then
    raise exception 'anon can read the portal tables';
  end if;
end $$;
