-- ===========================================================================
-- 0002_functions.sql — helpers, triggers and the tenancy predicate
--
-- The three `app_*` functions here are the only place tenancy is decided. Every
-- RLS policy in 0003 delegates to them, so there is one definition of "this
-- caller may see this business" rather than one per table.
-- ===========================================================================

-- --- tenancy ---------------------------------------------------------------

-- SECURITY DEFINER so that reading team_members from inside a team_members
-- policy does not recurse. `search_path` is pinned: a definer function that
-- resolves names through the caller's search_path is a privilege-escalation
-- hole, and every definer function in this file pins it for that reason.
create or replace function app_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.business_id
  from team_members tm
  where tm.user_id = auth.uid()
    and tm.deleted_at is null
    and tm.accepted_at is not null;
$$;

create or replace function app_is_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from team_members tm
    where tm.business_id = target
      and tm.user_id = auth.uid()
      and tm.deleted_at is null
      and tm.accepted_at is not null
  );
$$;

create or replace function app_role(target uuid)
returns team_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.role from team_members tm
  where tm.business_id = target
    and tm.user_id = auth.uid()
    and tm.deleted_at is null
    and tm.accepted_at is not null
  limit 1;
$$;

create or replace function app_has_role(target uuid, allowed team_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app_role(target) = any (allowed);
$$;

grant execute on function app_business_ids() to authenticated;
grant execute on function app_is_member(uuid) to authenticated;
grant execute on function app_role(uuid) to authenticated;
grant execute on function app_has_role(uuid, team_role[]) to authenticated;

-- --- housekeeping triggers -------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'businesses','profiles','team_members','customers','contacts','leads',
    'suppliers','materials','jobs','job_tasks','job_notes','estimates',
    'estimate_items','quotes','quote_items','invoices','invoice_items',
    'payments','expenses','work_logs','report_templates','reports',
    'job_photos','job_documents','email_accounts','email_threads','emails'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- --- new auth users --------------------------------------------------------

-- Supabase inserts into auth.users; this mirrors the row into profiles so the
-- app never needs read access to the auth schema.
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

  -- An invited team member signs up with the address they were invited at;
  -- claim any outstanding invitations for that address.
  update team_members
     set user_id = new.id,
         accepted_at = coalesce(accepted_at, now()),
         full_name = coalesce(full_name, new.raw_user_meta_data->>'full_name')
   where user_id is null
     and deleted_at is null
     and email = new.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- --- document numbering ----------------------------------------------------

-- Atomic per-business counter. The UPDATE takes a row lock, so two concurrent
-- quotes can never be handed the same number.
create or replace function next_document_number(target uuid, doc_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  seq_prefix text;
  seq_value integer;
  seq_padding integer;
begin
  if not app_is_member(target) then
    raise exception 'not a member of business %', target using errcode = '42501';
  end if;

  insert into number_sequences (business_id, kind, prefix, next_value)
  values (target, doc_kind, upper(substr(doc_kind, 1, 3)) || '-', 1)
  on conflict (business_id, kind) do nothing;

  update number_sequences
     set next_value = next_value + 1
   where business_id = target and kind = doc_kind
  returning prefix, next_value - 1, padding
    into seq_prefix, seq_value, seq_padding;

  return seq_prefix || lpad(seq_value::text, seq_padding, '0');
end;
$$;

grant execute on function next_document_number(uuid, text) to authenticated;

-- --- business creation -----------------------------------------------------

-- Creating a business is the one operation a signed-in user performs while
-- being a member of nothing. It runs as definer so the insert and the owner
-- membership land together; the caller is pinned to auth.uid(), so it cannot
-- be used to join a business that already exists.
create or replace function create_business_with_owner(
  p_name text,
  p_business_type text default null,
  p_abn text default null,
  p_email text default null,
  p_phone text default null,
  p_address_line1 text default null,
  p_suburb text default null,
  p_state text default null,
  p_postcode text default null,
  p_gst_registered boolean default true,
  p_payment_terms_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
  uid uuid := auth.uid();
  user_email text;
  user_name text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select email, full_name into user_email, user_name from profiles where id = uid;
  if user_email is null then
    select email into user_email from auth.users where id = uid;
  end if;

  insert into businesses (
    name, business_type, abn, email, phone, address_line1, suburb, state,
    postcode, gst_registered, default_payment_terms_days, onboarded_at
  ) values (
    p_name, p_business_type, nullif(regexp_replace(coalesce(p_abn, ''), '\s', '', 'g'), ''),
    nullif(p_email, ''), p_phone, p_address_line1, p_suburb, p_state,
    p_postcode, coalesce(p_gst_registered, true), coalesce(p_payment_terms_days, 14), now()
  ) returning id into new_id;

  insert into team_members (business_id, user_id, role, full_name, email, accepted_at)
  values (new_id, uid, 'owner', user_name, user_email, now());

  insert into number_sequences (business_id, kind, prefix) values
    (new_id, 'job', 'JOB-'),
    (new_id, 'estimate', 'EST-'),
    (new_id, 'quote', 'QUO-'),
    (new_id, 'invoice', 'INV-'),
    (new_id, 'report', 'REP-'),
    (new_id, 'expense', 'EXP-')
  on conflict do nothing;

  insert into activities (business_id, actor_id, actor_label, verb, summary, entity_type, entity_id)
  values (new_id, uid, coalesce(user_name, user_email), 'created',
          'Business created', 'business', new_id);

  return new_id;
end;
$$;

grant execute on function create_business_with_owner(
  text, text, text, text, text, text, text, text, text, boolean, integer
) to authenticated;

-- --- team invitations ------------------------------------------------------

-- Definer because the caller is, by definition, not yet a member of the
-- business whose invitation they are redeeming.
create or replace function accept_team_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member team_members%rowtype;
  uid uuid := auth.uid();
  user_email text;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into member from team_members
   where invite_token = p_token and deleted_at is null;

  if member.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if member.accepted_at is not null and member.user_id is distinct from uid then
    raise exception 'invitation already used' using errcode = '42501';
  end if;

  select email into user_email from profiles where id = uid;
  if lower(user_email) <> lower(member.email::text) then
    raise exception 'this invitation was issued to a different email address'
      using errcode = '42501';
  end if;

  update team_members
     set user_id = uid, accepted_at = coalesce(accepted_at, now()), invite_token = null
   where id = member.id;

  insert into activities (business_id, actor_id, actor_label, verb, summary, entity_type, entity_id)
  values (member.business_id, uid, coalesce(member.full_name, member.email::text),
          'joined', coalesce(member.full_name, member.email::text) || ' joined the team',
          'team_member', member.id);

  return member.business_id;
end;
$$;

grant execute on function accept_team_invite(text) to authenticated;

-- --- money ------------------------------------------------------------------

-- One line's money value. Quantities are thousandths so that 2.5 hours or
-- 0.375 tonnes are exact integers rather than floats.
create or replace function line_total_cents(quantity_milli bigint, unit_price_cents bigint)
returns bigint
language sql
immutable
as $$
  select round((quantity_milli::numeric * unit_price_cents::numeric) / 1000)::bigint;
$$;

-- Shared by quotes and invoices; mirrors computeDocumentTotals() in
-- src/lib/calc.ts, and tests/calc.test.ts checks the two agree.
create or replace function document_totals(
  p_subtotal bigint, p_taxable bigint, p_discount bigint, p_gst_bp integer, p_gst_applies boolean
)
returns table (subtotal_cents bigint, tax_cents bigint, total_cents bigint)
language sql
immutable
as $$
  with capped as (
    select least(greatest(p_discount, 0), greatest(p_subtotal, 0)) as discount
  ),
  base as (
    select
      case when p_subtotal > 0
           then greatest(p_taxable - round((c.discount::numeric * p_taxable) / p_subtotal)::bigint, 0)
           else 0 end as taxable_base,
      p_subtotal - c.discount as net
    from capped c
  )
  select
    p_subtotal,
    case when coalesce(p_gst_applies, true)
         then round((base.taxable_base::numeric * p_gst_bp) / 10000)::bigint
         else 0::bigint end,
    base.net + case when coalesce(p_gst_applies, true)
         then round((base.taxable_base::numeric * p_gst_bp) / 10000)::bigint
         else 0::bigint end
  from base;
$$;

create or replace function recalc_quote_totals(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s bigint; t bigint; q quotes%rowtype; r record;
begin
  select * into q from quotes where id = p_quote;
  if q.id is null then return; end if;

  select coalesce(sum(line_total_cents(quantity_milli, unit_price_cents)), 0),
         coalesce(sum(line_total_cents(quantity_milli, unit_price_cents)) filter (where taxable), 0)
    into s, t
    from quote_items where quote_id = p_quote;

  select * into r from document_totals(s, t, q.discount_cents, q.gst_bp, q.gst_applies);

  update quotes
     set subtotal_cents = r.subtotal_cents,
         tax_cents = r.tax_cents,
         total_cents = r.total_cents
   where id = p_quote;
end;
$$;

create or replace function recalc_invoice_totals(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s bigint; t bigint; i invoices%rowtype; r record;
begin
  select * into i from invoices where id = p_invoice;
  if i.id is null then return; end if;

  select coalesce(sum(line_total_cents(quantity_milli, unit_price_cents)), 0),
         coalesce(sum(line_total_cents(quantity_milli, unit_price_cents)) filter (where taxable), 0)
    into s, t
    from invoice_items where invoice_id = p_invoice;

  select * into r from document_totals(s, t, i.discount_cents, i.gst_bp, i.gst_applies);

  update invoices
     set subtotal_cents = r.subtotal_cents,
         tax_cents = r.tax_cents,
         total_cents = r.total_cents
   where id = p_invoice;
end;
$$;

create or replace function trg_quote_items_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform recalc_quote_totals(coalesce(new.quote_id, old.quote_id));
  return coalesce(new, old);
end $$;

drop trigger if exists quote_items_recalc on quote_items;
create trigger quote_items_recalc
  after insert or update or delete on quote_items
  for each row execute function trg_quote_items_recalc();

create or replace function trg_quote_header_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.discount_cents is distinct from old.discount_cents
     or new.gst_bp is distinct from old.gst_bp
     or new.gst_applies is distinct from old.gst_applies then
    perform recalc_quote_totals(new.id);
  end if;
  return new;
end $$;

drop trigger if exists quote_header_recalc on quotes;
create trigger quote_header_recalc
  after update on quotes
  for each row execute function trg_quote_header_recalc();

create or replace function trg_invoice_items_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform recalc_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end $$;

drop trigger if exists invoice_items_recalc on invoice_items;
create trigger invoice_items_recalc
  after insert or update or delete on invoice_items
  for each row execute function trg_invoice_items_recalc();

create or replace function trg_invoice_header_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.discount_cents is distinct from old.discount_cents
     or new.gst_bp is distinct from old.gst_bp
     or new.gst_applies is distinct from old.gst_applies then
    perform recalc_invoice_totals(new.id);
  end if;
  return new;
end $$;

drop trigger if exists invoice_header_recalc on invoices;
create trigger invoice_header_recalc
  after update on invoices
  for each row execute function trg_invoice_header_recalc();

-- --- payments roll up onto the invoice -------------------------------------

create or replace function recalc_invoice_payments(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid bigint;
  inv invoices%rowtype;
  new_status invoice_status;
begin
  select * into inv from invoices where id = p_invoice;
  if inv.id is null then return; end if;

  select coalesce(sum(amount_cents), 0) into paid
    from payments where invoice_id = p_invoice and deleted_at is null;

  new_status := inv.status;
  if inv.status not in ('draft', 'cancelled') then
    if paid <= 0 then
      new_status := case
        when inv.due_date is not null
             and inv.due_date < (now() at time zone 'Australia/Sydney')::date
        then 'overdue'
        when inv.viewed_at is not null then 'viewed'
        else 'sent' end;
    elsif paid < inv.total_cents then
      new_status := 'partially_paid';
    else
      new_status := 'paid';
    end if;
  end if;

  update invoices
     set paid_cents = paid,
         status = new_status,
         paid_at = case when new_status = 'paid' then coalesce(inv.paid_at, now()) else null end
   where id = p_invoice;
end;
$$;

create or replace function trg_payments_recalc()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform recalc_invoice_payments(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end $$;

drop trigger if exists payments_recalc on payments;
create trigger payments_recalc
  after insert or update or delete on payments
  for each row execute function trg_payments_recalc();

-- --- work log hours --------------------------------------------------------

create or replace function trg_work_log_minutes()
returns trigger language plpgsql as $$
declare
  span integer;
begin
  if new.start_time is not null and new.finish_time is not null then
    span := (extract(epoch from new.finish_time) - extract(epoch from new.start_time))::integer / 60;
    -- A finish before the start means the shift ran past midnight.
    if span < 0 then span := span + 24 * 60; end if;
    new.total_minutes := greatest(span - coalesce(new.break_minutes, 0), 0);
  end if;
  return new;
end $$;

drop trigger if exists work_logs_minutes on work_logs;
create trigger work_logs_minutes
  before insert or update on work_logs
  for each row execute function trg_work_log_minutes();

-- --- overdue invoices ------------------------------------------------------

-- Called by the dashboard on load, and safe to run from a scheduled job.
create or replace function mark_overdue_invoices(target uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if not app_is_member(target) then
    raise exception 'not a member of business %', target using errcode = '42501';
  end if;

  with updated as (
    update invoices
       set status = 'overdue'
     where business_id = target
       and deleted_at is null
       and status in ('sent', 'viewed', 'partially_paid')
       and due_date is not null
       and due_date < (now() at time zone 'Australia/Sydney')::date
    returning 1
  )
  select count(*) into n from updated;
  return n;
end $$;

grant execute on function mark_overdue_invoices(uuid) to authenticated;

-- --- public quote portal ---------------------------------------------------
--
-- The customer portal is unauthenticated: the share token is the credential.
-- Rather than open a row-level policy to anon (which would expose every column
-- of every joined table), the portal goes through these three definer
-- functions, which return exactly the fields a customer should see.

create or replace function public_quote_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q quotes%rowtype;
  b businesses%rowtype;
  c customers%rowtype;
  items jsonb;
begin
  if p_token is null or length(p_token) < 20 then
    return null;
  end if;

  select * into q from quotes
   where share_token = p_token and deleted_at is null;
  if q.id is null then return null; end if;

  select * into b from businesses where id = q.business_id;
  select * into c from customers where id = q.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', qi.id,
           'description', qi.description,
           'detail', qi.detail,
           'quantity_milli', qi.quantity_milli,
           'unit', qi.unit,
           'unit_price_cents', qi.unit_price_cents,
           'taxable', qi.taxable,
           'line_total_cents', line_total_cents(qi.quantity_milli, qi.unit_price_cents)
         ) order by qi.position, qi.created_at), '[]'::jsonb)
    into items
    from quote_items qi where qi.quote_id = q.id;

  -- First open marks the quote viewed; later opens do not overwrite it.
  if q.status = 'sent' and q.viewed_at is null then
    update quotes set status = 'viewed', viewed_at = now() where id = q.id;
    insert into activities (business_id, verb, summary, entity_type, entity_id, quote_id, customer_id)
    values (q.business_id, 'viewed', 'Quote ' || q.number || ' opened by the customer',
            'quote', q.id, q.id, q.customer_id);
    q.status := 'viewed';
    q.viewed_at := now();
  end if;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', q.id, 'number', q.number, 'version', q.version, 'status', q.status,
      'title', q.title, 'scope_of_work', q.scope_of_work, 'terms', q.terms,
      'payment_terms', q.payment_terms, 'issue_date', q.issue_date,
      'expiry_date', q.expiry_date, 'gst_bp', q.gst_bp, 'gst_applies', q.gst_applies,
      'discount_cents', q.discount_cents, 'subtotal_cents', q.subtotal_cents,
      'tax_cents', q.tax_cents, 'total_cents', q.total_cents,
      'accepted_at', q.accepted_at, 'declined_at', q.declined_at
    ),
    'business', jsonb_build_object(
      'name', b.name, 'abn', b.abn, 'email', b.email, 'phone', b.phone,
      'address_line1', b.address_line1, 'suburb', b.suburb, 'state', b.state,
      'postcode', b.postcode, 'logo_path', b.logo_path, 'gst_registered', b.gst_registered
    ),
    'customer', jsonb_build_object(
      'name', c.name, 'company', c.company, 'address_line1', c.address_line1,
      'suburb', c.suburb, 'state', c.state, 'postcode', c.postcode
    ),
    'items', items
  );
end $$;

create or replace function public_quote_respond(
  p_token text,
  p_action text,
  p_name text default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q quotes%rowtype;
  owner_user uuid;
begin
  if p_action not in ('accept', 'decline', 'request_changes', 'message') then
    raise exception 'unknown action' using errcode = '22023';
  end if;

  select * into q from quotes where share_token = p_token and deleted_at is null;
  if q.id is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  if q.status in ('cancelled', 'expired') then
    raise exception 'this quote is no longer open' using errcode = '22023';
  end if;
  if q.expiry_date is not null
     and q.expiry_date < (now() at time zone 'Australia/Sydney')::date
     and p_action = 'accept' then
    raise exception 'this quote has expired' using errcode = '22023';
  end if;
  -- Accepting twice is a no-op rather than an error: customers do re-open the
  -- link and press the button again.
  if q.status = 'accepted' and p_action = 'accept' then
    return jsonb_build_object('status', q.status, 'accepted_at', q.accepted_at);
  end if;

  if p_action = 'accept' then
    update quotes
       set status = 'accepted', accepted_at = now(),
           accepted_by_name = coalesce(nullif(p_name, ''), accepted_by_name),
           customer_message = coalesce(nullif(p_message, ''), customer_message)
     where id = q.id;
    update jobs set status = 'accepted'
     where id = q.job_id and status in ('lead', 'estimating', 'quote_sent');
  elsif p_action = 'decline' then
    update quotes
       set status = 'declined', declined_at = now(),
           decline_reason = nullif(p_message, ''),
           accepted_by_name = coalesce(nullif(p_name, ''), accepted_by_name)
     where id = q.id;
  elsif p_action = 'request_changes' then
    update quotes
       set status = 'changes_requested', customer_message = nullif(p_message, '')
     where id = q.id;
  else
    update quotes set customer_message = nullif(p_message, '') where id = q.id;
  end if;

  insert into activities (business_id, actor_label, verb, summary, entity_type, entity_id, quote_id, customer_id, job_id, meta)
  values (
    q.business_id, coalesce(nullif(p_name, ''), 'Customer'), p_action,
    case p_action
      when 'accept' then 'Quote ' || q.number || ' accepted by the customer'
      when 'decline' then 'Quote ' || q.number || ' declined by the customer'
      when 'request_changes' then 'Customer requested changes to quote ' || q.number
      else 'Customer left a message on quote ' || q.number end,
    'quote', q.id, q.id, q.customer_id, q.job_id,
    case when nullif(p_message, '') is null then null
         else jsonb_build_object('message', p_message) end
  );

  for owner_user in
    select user_id from team_members
     where business_id = q.business_id and deleted_at is null and user_id is not null
       and role in ('owner', 'admin', 'manager')
  loop
    insert into notifications (business_id, user_id, kind, title, body, link, severity)
    values (
      q.business_id, owner_user,
      case p_action when 'accept' then 'quote_accepted'
                    when 'decline' then 'quote_declined'
                    when 'request_changes' then 'quote_changes_requested'
                    else 'customer_message' end,
      case p_action when 'accept' then 'Quote ' || q.number || ' accepted'
                    when 'decline' then 'Quote ' || q.number || ' declined'
                    when 'request_changes' then 'Changes requested on ' || q.number
                    else 'Message on quote ' || q.number end,
      nullif(p_message, ''),
      '/quotes/' || q.id,
      case p_action when 'accept' then 'success'
                    when 'decline' then 'danger'
                    else 'warning' end
    );
  end loop;

  select status into q.status from quotes where id = q.id;
  return jsonb_build_object('status', q.status);
end $$;

create or replace function public_invoice_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i invoices%rowtype;
  b businesses%rowtype;
  c customers%rowtype;
  items jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;

  select * into i from invoices where share_token = p_token and deleted_at is null;
  if i.id is null then return null; end if;

  select * into b from businesses where id = i.business_id;
  select * into c from customers where id = i.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ii.id, 'description', ii.description, 'detail', ii.detail,
           'quantity_milli', ii.quantity_milli, 'unit', ii.unit,
           'unit_price_cents', ii.unit_price_cents, 'taxable', ii.taxable,
           'line_total_cents', line_total_cents(ii.quantity_milli, ii.unit_price_cents)
         ) order by ii.position, ii.created_at), '[]'::jsonb)
    into items from invoice_items ii where ii.invoice_id = i.id;

  if i.status = 'sent' and i.viewed_at is null then
    update invoices set status = 'viewed', viewed_at = now() where id = i.id;
    i.status := 'viewed';
  end if;

  return jsonb_build_object(
    'invoice', to_jsonb(i) - 'share_token' - 'created_by' - 'business_id',
    'business', jsonb_build_object(
      'name', b.name, 'abn', b.abn, 'email', b.email, 'phone', b.phone,
      'address_line1', b.address_line1, 'suburb', b.suburb, 'state', b.state,
      'postcode', b.postcode, 'logo_path', b.logo_path, 'gst_registered', b.gst_registered,
      'bank_account_name', b.bank_account_name, 'bank_bsb', b.bank_bsb,
      'bank_account_number', b.bank_account_number
    ),
    'customer', jsonb_build_object(
      'name', c.name, 'company', c.company, 'address_line1', c.address_line1,
      'suburb', c.suburb, 'state', c.state, 'postcode', c.postcode
    ),
    'items', items
  );
end $$;

grant execute on function public_quote_by_token(text) to anon, authenticated;
grant execute on function public_quote_respond(text, text, text, text) to anon, authenticated;
grant execute on function public_invoice_by_token(text) to anon, authenticated;

-- --- dashboard -------------------------------------------------------------

-- One round trip for the whole dashboard. Every aggregate is scoped by the
-- membership check on the first line.
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
      select coalesce(sum(p.amount_cents), 0) from payments p
       where p.business_id = target and p.deleted_at is null
         and p.paid_on >= date_trunc('year', today)::date),
    'revenue_30d_cents', (
      select coalesce(sum(p.amount_cents), 0) from payments p
       where p.business_id = target and p.deleted_at is null
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
               coalesce((select sum(p.amount_cents) from payments p
                          where p.business_id = target and p.deleted_at is null
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

-- --- job profitability -----------------------------------------------------

create or replace function job_profitability(p_job uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j jobs%rowtype;
  invoiced bigint; paid bigint; spent bigint; labour_minutes bigint;
begin
  select * into j from jobs where id = p_job;
  if j.id is null or not app_is_member(j.business_id) then
    raise exception 'job not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(i.total_cents - i.tax_cents), 0), coalesce(sum(i.paid_cents), 0)
    into invoiced, paid
    from invoices i where i.job_id = p_job and i.deleted_at is null and i.status <> 'cancelled';

  select coalesce(sum(e.amount_cents - e.gst_cents), 0) into spent
    from expenses e where e.job_id = p_job and e.deleted_at is null;

  select coalesce(sum(w.total_minutes * greatest(w.worker_count, 1)), 0) into labour_minutes
    from work_logs w where w.job_id = p_job and w.deleted_at is null;

  return jsonb_build_object(
    'invoiced_ex_gst_cents', invoiced,
    'paid_cents', paid,
    'expenses_ex_gst_cents', spent,
    'profit_cents', invoiced - spent,
    'margin_bp', case when invoiced > 0
                      then round(((invoiced - spent)::numeric / invoiced) * 10000)::integer
                      else 0 end,
    'labour_minutes', labour_minutes,
    'budget_cents', j.budget_cents
  );
end $$;

grant execute on function job_profitability(uuid) to authenticated;
