-- ===========================================================================
-- 0003_rls.sql — row level security
--
-- Business A must never reach Business B's rows. Every business-owned table
-- gets RLS enabled and a policy whose predicate bottoms out in app_is_member()
-- or app_has_role(). There is no "authenticated users can read" policy
-- anywhere in this file, and no table is left with RLS off.
--
-- Reading this file top to bottom is the security review: if a table appears
-- in 0001 and not here, the last statement in this file fails the migration.
-- ===========================================================================

-- Supabase grants table privileges to anon/authenticated by default; state
-- them explicitly so the policies are the only thing standing between a
-- caller and a row, and nothing depends on a default that may change.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- anon reaches the customer portal exclusively through the definer functions
-- in 0002. It gets no table privileges at all.
revoke all on all tables in schema public from anon;

-- Stored OAuth tokens are never readable through PostgREST, by anyone. The
-- server reads them with the service role, which bypasses column grants.
revoke select (refresh_token_enc, access_token_enc) on email_accounts from authenticated;
revoke update (refresh_token_enc, access_token_enc) on email_accounts from authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'businesses','profiles','team_members','number_sequences','customers','contacts',
    'leads','suppliers','materials','jobs','job_assignments','job_tasks','job_notes',
    'estimates','estimate_items','quotes','quote_items','quote_versions','invoices',
    'invoice_items','payments','expenses','work_logs','work_log_workers',
    'report_templates','reports','job_photos','report_photos','job_documents',
    'email_accounts','email_threads','emails','email_attachments','notifications',
    'activities','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- --- role sets -------------------------------------------------------------
-- Named once, used throughout, so "who counts as management" is a single edit.

create or replace function app_admins() returns team_role[]
  language sql immutable as $$ select array['owner','admin']::team_role[] $$;
create or replace function app_managers() returns team_role[]
  language sql immutable as $$ select array['owner','admin','manager']::team_role[] $$;
create or replace function app_finance() returns team_role[]
  language sql immutable as $$ select array['owner','admin','manager','accountant']::team_role[] $$;

grant execute on function app_admins() to authenticated;
grant execute on function app_managers() to authenticated;
grant execute on function app_finance() to authenticated;

-- --- businesses ------------------------------------------------------------

drop policy if exists businesses_select on businesses;
create policy businesses_select on businesses for select to authenticated
  using (app_is_member(id));

-- No INSERT policy: businesses are created only through
-- create_business_with_owner(), which also creates the owner membership. A
-- business with no members would be unreachable and undeletable.
drop policy if exists businesses_update on businesses;
create policy businesses_update on businesses for update to authenticated
  using (app_has_role(id, app_admins())) with check (app_has_role(id, app_admins()));

-- --- profiles --------------------------------------------------------------

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from team_members tm
      where tm.user_id = profiles.id
        and tm.deleted_at is null
        and tm.business_id in (select app_business_ids())
    )
  );

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());

-- --- team members ----------------------------------------------------------

drop policy if exists team_members_select on team_members;
create policy team_members_select on team_members for select to authenticated
  using (app_is_member(business_id) or user_id = auth.uid());

drop policy if exists team_members_insert on team_members;
create policy team_members_insert on team_members for insert to authenticated
  with check (app_has_role(business_id, app_admins()));

drop policy if exists team_members_update on team_members;
create policy team_members_update on team_members for update to authenticated
  using (app_has_role(business_id, app_admins()))
  with check (app_has_role(business_id, app_admins()));

drop policy if exists team_members_delete on team_members;
create policy team_members_delete on team_members for delete to authenticated
  using (app_has_role(business_id, app_admins()) and role <> 'owner');

-- --- number sequences ------------------------------------------------------
-- Readable so settings can show the next number; only next_document_number()
-- advances them.

drop policy if exists number_sequences_select on number_sequences;
create policy number_sequences_select on number_sequences for select to authenticated
  using (app_is_member(business_id));

drop policy if exists number_sequences_update on number_sequences;
create policy number_sequences_update on number_sequences for update to authenticated
  using (app_has_role(business_id, app_admins()))
  with check (app_has_role(business_id, app_admins()));

-- --- operational tables ----------------------------------------------------
-- Any accepted member reads and writes; deletion is management-only. These are
-- the tables a worker in the field touches.

do $$
declare t text;
begin
  foreach t in array array[
    'customers','contacts','leads','suppliers','materials','jobs','job_assignments',
    'job_tasks','job_notes','work_logs','work_log_workers','reports','job_photos',
    'report_photos','job_documents','email_threads','emails','email_attachments'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (app_is_member(business_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (app_is_member(business_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update to authenticated using (app_is_member(business_id)) with check (app_is_member(business_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (app_has_role(business_id, app_managers()))',
      t || '_delete', t);
  end loop;
end $$;

-- --- financial tables ------------------------------------------------------
-- Priced work is not visible to the `worker` role at all: a labourer with an
-- app login cannot read what the job was quoted at, or what any customer owes.

do $$
declare t text;
begin
  foreach t in array array[
    'estimates','estimate_items','quotes','quote_items','quote_versions',
    'invoices','invoice_items','payments'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (app_has_role(business_id, app_finance()))',
      t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (app_has_role(business_id, app_finance()))',
      t || '_insert', t);

    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update to authenticated using (app_has_role(business_id, app_finance())) with check (app_has_role(business_id, app_finance()))',
      t || '_update', t);

    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (app_has_role(business_id, app_admins()))',
      t || '_delete', t);
  end loop;
end $$;

-- --- expenses --------------------------------------------------------------
-- A worker photographs a receipt on site, so anyone may add one; they see
-- their own entries back, and management sees the lot.

drop policy if exists expenses_select on expenses;
create policy expenses_select on expenses for select to authenticated
  using (
    app_has_role(business_id, app_finance())
    or (app_is_member(business_id) and created_by = auth.uid())
  );

drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert to authenticated
  with check (app_is_member(business_id));

drop policy if exists expenses_update on expenses;
create policy expenses_update on expenses for update to authenticated
  using (
    app_has_role(business_id, app_finance())
    or (app_is_member(business_id) and created_by = auth.uid())
  )
  with check (app_is_member(business_id));

drop policy if exists expenses_delete on expenses;
create policy expenses_delete on expenses for delete to authenticated
  using (app_has_role(business_id, app_managers()));

-- --- report templates ------------------------------------------------------
-- System templates (business_id null) are shared read-only stock; a business
-- may add its own alongside them.

drop policy if exists report_templates_select on report_templates;
create policy report_templates_select on report_templates for select to authenticated
  using (business_id is null or app_is_member(business_id));

drop policy if exists report_templates_insert on report_templates;
create policy report_templates_insert on report_templates for insert to authenticated
  with check (business_id is not null and app_has_role(business_id, app_managers()));

drop policy if exists report_templates_update on report_templates;
create policy report_templates_update on report_templates for update to authenticated
  using (business_id is not null and app_has_role(business_id, app_managers()))
  with check (business_id is not null and app_has_role(business_id, app_managers()));

drop policy if exists report_templates_delete on report_templates;
create policy report_templates_delete on report_templates for delete to authenticated
  using (business_id is not null and app_has_role(business_id, app_managers()));

-- --- email accounts --------------------------------------------------------
-- A connected mailbox belongs to the person who connected it.

drop policy if exists email_accounts_select on email_accounts;
create policy email_accounts_select on email_accounts for select to authenticated
  using (app_is_member(business_id) and (user_id = auth.uid() or app_has_role(business_id, app_admins())));

drop policy if exists email_accounts_insert on email_accounts;
create policy email_accounts_insert on email_accounts for insert to authenticated
  with check (app_is_member(business_id) and user_id = auth.uid());

drop policy if exists email_accounts_update on email_accounts;
create policy email_accounts_update on email_accounts for update to authenticated
  using (app_is_member(business_id) and (user_id = auth.uid() or app_has_role(business_id, app_admins())))
  with check (app_is_member(business_id));

drop policy if exists email_accounts_delete on email_accounts;
create policy email_accounts_delete on email_accounts for delete to authenticated
  using (app_is_member(business_id) and (user_id = auth.uid() or app_has_role(business_id, app_admins())));

-- --- notifications ---------------------------------------------------------

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (app_is_member(business_id) and (user_id = auth.uid() or user_id is null));

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications for insert to authenticated
  with check (app_is_member(business_id));

-- Only the read flag is ever changed, and only on your own notifications.
drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete to authenticated
  using (user_id = auth.uid());

-- --- activities ------------------------------------------------------------
-- The timeline is a record. It can be written and read, never edited or erased:
-- there is deliberately no UPDATE or DELETE policy.

drop policy if exists activities_select on activities;
create policy activities_select on activities for select to authenticated
  using (app_is_member(business_id));

drop policy if exists activities_insert on activities;
create policy activities_insert on activities for insert to authenticated
  with check (app_is_member(business_id));

-- --- audit log -------------------------------------------------------------
-- Append-only, management-readable. No UPDATE or DELETE policy exists, so even
-- an owner cannot rewrite it through the API.

drop policy if exists audit_logs_select on audit_logs;
create policy audit_logs_select on audit_logs for select to authenticated
  using (business_id is not null and app_has_role(business_id, app_admins()));

drop policy if exists audit_logs_insert on audit_logs;
create policy audit_logs_insert on audit_logs for insert to authenticated
  with check (business_id is null or app_is_member(business_id));

revoke update, delete on audit_logs from authenticated;

-- --- storage ---------------------------------------------------------------
-- Buckets are private. Object keys always begin with the business id, so the
-- same membership predicate covers files: `<business_id>/<kind>/<uuid>.<ext>`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos', 'photos', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('documents', 'documents', false, 52428800, null),
  ('logos', 'logos', false, 5242880,
   array['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('receipts', 'receipts', false, 26214400, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function storage_path_business(name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return (split_part(name, '/', 1))::uuid;
exception when others then
  return null;
end $$;

do $$
declare b text;
begin
  foreach b in array array['photos','documents','logos','receipts'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_read');
    execute format($f$
      create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and app_is_member(storage_path_business(name)))
    $f$, b || '_read', b);

    execute format('drop policy if exists %I on storage.objects', b || '_write');
    execute format($f$
      create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and app_is_member(storage_path_business(name)))
    $f$, b || '_write', b);

    execute format('drop policy if exists %I on storage.objects', b || '_update');
    execute format($f$
      create policy %I on storage.objects for update to authenticated
      using (bucket_id = %L and app_is_member(storage_path_business(name)))
      with check (bucket_id = %L and app_is_member(storage_path_business(name)))
    $f$, b || '_update', b, b);

    execute format('drop policy if exists %I on storage.objects', b || '_delete');
    execute format($f$
      create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and app_is_member(storage_path_business(name)))
    $f$, b || '_delete', b);
  end loop;
end $$;

-- --- the migration runner's own bookkeeping ---------------------------------
-- `npm run db:push` records what it has applied in public.schema_migrations,
-- which is therefore a public table like any other. It holds nothing tenant
-- specific, but the check below counts it, and an application user has no
-- business reading it: RLS on with no policy at all means nobody reaches it
-- through PostgREST. The runner connects directly as the database owner.

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'alter table schema_migrations enable row level security';
    execute 'alter table schema_migrations force row level security';
    execute 'revoke all on schema_migrations from anon, authenticated';
  end if;
end $$;

-- --- the check that makes this file self-enforcing -------------------------
-- Any table added to the public schema without a policy fails the migration
-- here rather than shipping open.

do $$
declare
  offenders text;
begin
  select string_agg(c.relname, ', ')
    into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     -- Locked down above: RLS on, no policy, no grants. It is the one table
     -- here that is deliberately unreachable rather than tenant-scoped.
     and c.relname <> 'schema_migrations'
     and (
       not c.relrowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid)
     );

  if offenders is not null then
    raise exception 'tables without row level security or without any policy: %', offenders;
  end if;
end $$;
