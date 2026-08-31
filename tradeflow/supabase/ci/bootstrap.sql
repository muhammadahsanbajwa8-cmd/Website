-- ===========================================================================
-- bootstrap.sql — the parts of Supabase the migrations depend on.
--
-- Used only by CI, so the tenancy suite can run against a plain Postgres
-- container. It creates the roles, the `auth` schema and the `storage` schema
-- that a real Supabase project provides, with the same shapes the migrations
-- and the application actually use:
--
--   auth.users                the table every created_by / user_id points at
--   auth.uid()                the caller's id, read from the request JWT claims
--   storage.buckets/objects   what the file policies are written against
--
-- It is deliberately minimal. It is not a Supabase emulator and must never be
-- applied to a real project — Supabase ships its own, richer versions of all
-- of this, and this file would be a downgrade.
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- --- roles ------------------------------------------------------------------
-- PostgREST connects as `authenticator` and assumes one of these per request.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant anon, authenticated, service_role to current_user;

-- --- auth --------------------------------------------------------------------

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              citext unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- The caller's id, exactly as Supabase defines it: read out of the request's
-- JWT claims, which PostgREST sets per request and the tests set per
-- transaction. Null when there is no session — which is why every policy that
-- delegates to it refuses an anonymous caller.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- --- storage -----------------------------------------------------------------

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid references auth.users(id),
  metadata   jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
