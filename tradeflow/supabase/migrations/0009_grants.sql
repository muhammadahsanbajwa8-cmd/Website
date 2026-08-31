-- ===========================================================================
-- 0009 — say the grants out loud
--
-- Migration 0003 runs `grant … on all tables in schema public to authenticated`.
-- That is a point-in-time statement: it covers the tables that existed when it
-- ran, and nothing added afterwards. Every table created in 0005 and 0007 —
-- the AI brain, calls, customer logins, payment events — has been relying on
-- Supabase's own default privileges to be reachable at all.
--
-- On Supabase that happens to work. On a plain Postgres it does not, and the
-- failure is quiet in the worst way: the row level security is correct, the
-- policy is correct, and the query is refused for a reason neither of them
-- explains. It cost a debugging session to find, which is the argument for not
-- leaving it implicit.
--
-- So: re-apply the grants now that every table exists, and set default
-- privileges so a table added by a future migration is covered without anyone
-- having to remember this file.
--
-- This grants table privileges only. Row level security still decides which
-- rows a caller sees, and `anon` is still stripped of everything — the portal
-- reaches its three functions and nothing else.
-- ===========================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- The service role bypasses RLS by design and is used only from server code:
-- signing storage URLs, reading encrypted mailbox tokens, and recording
-- webhooks that arrive with no session.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Anything created from here on.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;

-- --- and take back what anon must never have --------------------------------
-- Re-stated after the grants above, because `all tables` would otherwise have
-- handed anon the lot. anon reaches the customer portal exclusively through
-- the definer functions.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- `public_invoice_payable` carries the business's connected account id and its
-- platform fee. The blanket function grant above would have handed it to every
-- signed-in user; take it back. Only the service role calls it, from the
-- checkout route, after checking the share token.
revoke all on function public_invoice_payable(text) from public, anon, authenticated;

-- The encrypted mailbox tokens stay unreadable through PostgREST, by anyone.
revoke select (refresh_token_enc, access_token_enc) on email_accounts from authenticated;
revoke update (refresh_token_enc, access_token_enc) on email_accounts from authenticated;

-- The migration runner's own bookkeeping stays unreachable.
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    execute 'revoke all on schema_migrations from anon, authenticated';
  end if;
end $$;

-- --- prove it ---------------------------------------------------------------
-- Every table an application user is meant to reach must actually be reachable,
-- and anon must reach none of them. A future table that misses out fails here.

do $$
declare
  unreachable text;
  anon_can_reach text;
begin
  select string_agg(c.relname, ', ')
    into unreachable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname <> 'schema_migrations'
     and not has_table_privilege('authenticated', c.oid, 'SELECT');

  if unreachable is not null then
    raise exception 'authenticated cannot select from: %', unreachable;
  end if;

  select string_agg(c.relname, ', ')
    into anon_can_reach
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'SELECT');

  if anon_can_reach is not null then
    raise exception 'anon can select from: %', anon_can_reach;
  end if;
end $$;
