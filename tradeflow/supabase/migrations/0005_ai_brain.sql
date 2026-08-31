-- ===========================================================================
-- 0005_ai_brain.sql — the AI Business Brain and the phone agent
--
-- The point of this schema is that the assistant is *this business's*
-- assistant, not a generic bot pointed at a database. Three layers feed it:
--
--   industry_profiles  the vocabulary of a trade (mortar, DPC, weep holes;
--                      patrol, incident, access control; RCD, switchboard),
--                      shared across every business in that trade
--   ai_brain           one row per business: its services, hours, staff,
--                      area, tone of voice, and the two lists that matter
--                      most — what it may say and what it must never say
--   ai_faqs / ai_knowledge   the specific answers and documents a business
--                      wants the agent to know
--
-- Calls are recorded turn by turn, and what a call *meant* — the task, the
-- deadline, the priority — is extracted after it ends into call_actions,
-- which a person confirms before anything is created.
-- ===========================================================================

do $$ begin
  create type call_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  create type call_status as enum (
    'ringing', 'in_progress', 'completed', 'no_answer', 'failed', 'voicemail'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type call_turn_role as enum ('caller', 'agent', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_voice_tone as enum (
    'professional', 'friendly', 'casual', 'warm', 'concise', 'formal'
  );
exception when duplicate_object then null; end $$;

-- --- industry vocabulary ---------------------------------------------------
-- business_id null marks a system profile: readable by every tenant, writable
-- by none.

create table if not exists industry_profiles (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references businesses(id) on delete cascade,
  key           text not null,
  name          text not null,
  description   text,
  /* Words the agent should recognise in speech and use back naturally. */
  terminology   text[] not null default '{}',
  /* The kinds of work this trade is asked for. */
  common_services text[] not null default '{}',
  /* Questions this trade is asked on the phone all day. */
  common_questions text[] not null default '{}',
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists industry_profiles_system_key_uniq
  on industry_profiles (key) where business_id is null;
create unique index if not exists industry_profiles_business_key_uniq
  on industry_profiles (business_id, key) where business_id is not null;

-- --- the business brain ----------------------------------------------------

create table if not exists ai_brain (
  business_id   uuid primary key references businesses(id) on delete cascade,
  industry_key  text,

  -- How it should sound.
  tone          ai_voice_tone not null default 'friendly',
  voice_name    text not null default 'alice',
  speaking_rate numeric(3,2) not null default 1.00 check (speaking_rate between 0.50 and 2.00),
  language      text not null default 'en-AU',

  -- What it says when it picks up. The disclosure that it is an AI assistant
  -- is appended by the application and is not editable away.
  greeting      text,
  after_hours_greeting text,
  voicemail_greeting text,

  -- What the business does.
  services      text[] not null default '{}',
  service_area  text,
  business_hours jsonb not null default '{}'::jsonb,
  emergency_hours text,

  -- Who is who, so "is John about?" gets a sensible answer.
  staff         jsonb not null default '[]'::jsonb,
  escalation_name text,
  escalation_phone text,
  escalation_email citext,

  -- The two lists that decide what the agent is allowed to be.
  allowed_topics  text[] not null default '{}',
  forbidden_topics text[] not null default '{}',
  /* Free text: house rules in the business's own words. */
  policies      text,
  pricing_guidance text,

  -- Behaviour switches.
  disclose_ai   boolean not null default true,
  may_discuss_pricing boolean not null default false,
  may_confirm_bookings boolean not null default false,
  may_share_job_status boolean not null default true,
  max_call_minutes integer not null default 10 check (max_call_minutes between 1 and 60),

  enabled       boolean not null default false,
  phone_number  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists ai_faqs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question    text not null check (length(btrim(question)) > 0),
  answer      text not null check (length(btrim(answer)) > 0),
  category    text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists ai_faqs_business_idx on ai_faqs (business_id, position) where deleted_at is null;

create table if not exists ai_knowledge (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  title       text not null,
  body        text not null,
  category    text not null default 'general',
  /* Approved for the agent to quote from on a call. */
  approved    boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists ai_knowledge_business_idx on ai_knowledge (business_id) where deleted_at is null;

-- --- calls -----------------------------------------------------------------

create table if not exists calls (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  direction     call_direction not null default 'inbound',
  status        call_status not null default 'in_progress',
  provider      text not null default 'console',
  provider_call_sid text,

  from_number   text,
  to_number     text,
  caller_name   text,
  customer_id   uuid references customers(id) on delete set null,
  job_id        uuid references jobs(id) on delete set null,

  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_seconds integer,

  -- What the agent worked out during and after the call.
  summary       text,
  intent        text,
  sentiment     text check (sentiment is null or sentiment in ('positive', 'neutral', 'frustrated', 'angry')),
  outcome       text,
  escalated     boolean not null default false,
  escalation_reason text,
  after_hours   boolean not null default false,
  handled_by_ai boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists calls_business_idx on calls (business_id, started_at desc) where deleted_at is null;
create index if not exists calls_customer_idx on calls (customer_id) where deleted_at is null;
create index if not exists calls_job_idx on calls (job_id) where deleted_at is null;
create unique index if not exists calls_provider_sid_uniq
  on calls (provider, provider_call_sid) where provider_call_sid is not null;

create table if not exists call_turns (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id     uuid not null references calls(id) on delete cascade,
  role        call_turn_role not null,
  text        text not null,
  /* Speech recognition confidence, 0–1, when the provider reports one. */
  confidence  numeric(4,3),
  /* How long the agent took to answer, for tuning the barge-in window. */
  latency_ms  integer,
  /* True when the caller talked over the agent and cut it off. */
  interrupted boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists call_turns_call_idx on call_turns (call_id, position);

-- What the call actually asked for, extracted after it ended. Nothing here is
-- acted on until a person applies it.
create table if not exists call_actions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id     uuid not null references calls(id) on delete cascade,
  kind        text not null check (kind in ('task', 'note', 'callback', 'quote_request', 'complaint', 'booking')),
  title       text not null,
  detail      text,
  priority    task_priority not null default 'medium',
  due_date    date,
  suggested_job_id uuid references jobs(id) on delete set null,
  suggested_customer_id uuid references customers(id) on delete set null,
  applied     boolean not null default false,
  applied_at  timestamptz,
  task_id     uuid references job_tasks(id) on delete set null,
  dismissed   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists call_actions_call_idx on call_actions (call_id);
create index if not exists call_actions_pending_idx
  on call_actions (business_id) where not applied and not dismissed;

-- The owner's correction, which becomes knowledge rather than training data.
create table if not exists ai_feedback (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  call_id       uuid references calls(id) on delete cascade,
  turn_id       uuid references call_turns(id) on delete set null,
  rating        text not null check (rating in ('good', 'needs_improvement')),
  misunderstanding text,
  correction    text,
  /* Set when the correction has been written into ai_knowledge. */
  applied_to_brain boolean not null default false,
  knowledge_id  uuid references ai_knowledge(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists ai_feedback_business_idx on ai_feedback (business_id, created_at desc);

-- --- housekeeping ----------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'industry_profiles','ai_brain','ai_faqs','ai_knowledge','calls','call_actions'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- Every business gets a brain row the moment it is created, so the settings
-- page never has to handle "no row yet".
create or replace function ensure_ai_brain(target uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare b businesses%rowtype;
begin
  if not app_is_member(target) then
    raise exception 'not a member of business %', target using errcode = '42501';
  end if;

  select * into b from businesses where id = target;
  if b.id is null then return; end if;

  insert into ai_brain (business_id, industry_key, greeting, services)
  values (
    target,
    lower(replace(coalesce(b.business_type, 'other'), ' ', '_')),
    'Hi, you''ve reached ' || b.name || '.',
    case when b.business_type is null then '{}'::text[] else array[b.business_type] end
  )
  on conflict (business_id) do nothing;
end $$;

grant execute on function ensure_ai_brain(uuid) to authenticated;

-- --- who a caller is -------------------------------------------------------
--
-- Called at the start of a call, before any user session exists, so it runs as
-- definer and takes the business explicitly. It returns only what the agent is
-- allowed to greet someone with — a name and their open work — never the whole
-- customer record.

create or replace function ai_identify_caller(target uuid, p_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  digits text;
  c customers%rowtype;
  jobs_json jsonb;
begin
  if p_number is null then return null; end if;

  -- Match on the last eight digits: a number stored as 0400 123 456 should
  -- still match +61400123456 arriving from the carrier.
  digits := right(regexp_replace(p_number, '\D', '', 'g'), 8);
  if length(digits) < 8 then return null; end if;

  select * into c from customers
   where business_id = target
     and deleted_at is null
     and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = digits
   limit 1;

  if c.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'number', j.number, 'name', j.name, 'status', j.status,
           'site', concat_ws(' ', j.site_address_line1, j.site_suburb),
           'expected_completion', j.expected_completion_date
         ) order by j.updated_at desc), '[]'::jsonb)
    into jobs_json
    from jobs j
   where j.business_id = target and j.customer_id = c.id and j.deleted_at is null
     and j.status not in ('cancelled', 'paid')
   limit 5;

  return jsonb_build_object(
    'customer_id', c.id,
    'name', c.name,
    'company', c.company,
    'jobs', jobs_json
  );
end $$;

grant execute on function ai_identify_caller(uuid, text) to authenticated, service_role;

-- --- row level security ----------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'industry_profiles','ai_brain','ai_faqs','ai_knowledge','calls','call_turns',
    'call_actions','ai_feedback'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Industry profiles: system rows readable by all, business rows by members.
drop policy if exists industry_profiles_select on industry_profiles;
create policy industry_profiles_select on industry_profiles for select to authenticated
  using (business_id is null or app_is_member(business_id));

drop policy if exists industry_profiles_write on industry_profiles;
create policy industry_profiles_write on industry_profiles for insert to authenticated
  with check (business_id is not null and app_has_role(business_id, app_admins()));

drop policy if exists industry_profiles_update on industry_profiles;
create policy industry_profiles_update on industry_profiles for update to authenticated
  using (business_id is not null and app_has_role(business_id, app_admins()))
  with check (business_id is not null and app_has_role(business_id, app_admins()));

drop policy if exists industry_profiles_delete on industry_profiles;
create policy industry_profiles_delete on industry_profiles for delete to authenticated
  using (business_id is not null and app_has_role(business_id, app_admins()));

-- The brain: everyone in the business can read what the agent knows (a worker
-- should be able to see what it tells customers); only management edits it.
drop policy if exists ai_brain_select on ai_brain;
create policy ai_brain_select on ai_brain for select to authenticated
  using (app_is_member(business_id));

drop policy if exists ai_brain_insert on ai_brain;
create policy ai_brain_insert on ai_brain for insert to authenticated
  with check (app_has_role(business_id, app_managers()));

drop policy if exists ai_brain_update on ai_brain;
create policy ai_brain_update on ai_brain for update to authenticated
  using (app_has_role(business_id, app_managers()))
  with check (app_has_role(business_id, app_managers()));

do $$
declare t text;
begin
  foreach t in array array['ai_faqs','ai_knowledge'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (app_is_member(business_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (app_has_role(business_id, app_managers()))',
      t || '_insert', t);

    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update to authenticated using (app_has_role(business_id, app_managers())) with check (app_has_role(business_id, app_managers()))',
      t || '_update', t);

    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format(
      'create policy %I on %I for delete to authenticated using (app_has_role(business_id, app_managers()))',
      t || '_delete', t);
  end loop;
end $$;

-- Calls and their transcripts: a recording of a customer conversation is not
-- something a labourer's login should be able to page through, so reading is
-- management and above.
do $$
declare t text;
begin
  foreach t in array array['calls','call_turns','call_actions','ai_feedback'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using (app_has_role(business_id, app_managers()))',
      t || '_select', t);

    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (app_has_role(business_id, app_managers()))',
      t || '_insert', t);

    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for update to authenticated using (app_has_role(business_id, app_managers())) with check (app_has_role(business_id, app_managers()))',
      t || '_update', t);
  end loop;
end $$;

-- A transcript is a record of what was said. It can be added to and read; it
-- has no delete policy, on purpose.
drop policy if exists calls_delete on calls;
create policy calls_delete on calls for delete to authenticated
  using (app_has_role(business_id, app_admins()));

-- --- stock industry profiles ----------------------------------------------

insert into industry_profiles (business_id, key, name, description, is_system, terminology, common_services, common_questions)
values
(null, 'bricklayer', 'Bricklaying and blockwork',
 'Face brick, blockwork, retaining walls and repointing.', true,
 array['brickwork','blockwork','mortar','DPC','damp proof course','flashing','control joint',
       'articulation joint','weep hole','scaffolding','base course','repointing','retaining wall',
       'header course','stretcher bond','lintel','render','bagging','course','perpend','bed joint'],
 array['Face brickwork','Blockwork','Retaining walls','Repointing','Brick repairs','Rendering'],
 array['How long does a brick wall take?','Do you provide materials?','Do you do weekend work?',
       'Can you match existing bricks?','Do I need council approval for a retaining wall?']),

(null, 'security', 'Security services',
 'Static guards, mobile patrols, alarm response and incident reporting.', true,
 array['patrol','incident','site','guard','access control','visitor','CCTV','incident report',
       'alarm response','checkpoint','static guard','mobile patrol','licence','crowd control',
       'lock-up','key holding','after-hours response'],
 array['Static guarding','Mobile patrols','Alarm response','Event security','Key holding'],
 array['How quickly can you attend an alarm?','Are your guards licensed?',
       'Can we get a patrol report each morning?','Do you cover public holidays?']),

(null, 'electrician', 'Electrical contracting',
 'Domestic and commercial electrical work, testing and compliance.', true,
 array['switchboard','circuit','RCD','safety switch','power point','GPO','electrical inspection',
       'certificate of compliance','CoC','three phase','single phase','sub-main','earthing',
       'tag and test','LED upgrade','smoke alarm','data cabling','fault find'],
 array['Fault finding','Switchboard upgrades','Power points and lighting','Safety switch installation',
       'Smoke alarms','Test and tag'],
 array['How much is a call-out?','Can you come today?','Do you provide a certificate of compliance?',
       'Do you do emergency work?']),

(null, 'plumber', 'Plumbing and gasfitting',
 'Blockages, leaks, hot water, roofing and gas.', true,
 array['blockage','jetting','CCTV drain camera','hot water unit','tempering valve','backflow',
       'gas fitting','isolation valve','trap','stormwater','sewer','relining','tapware',
       'compliance certificate','burst','leak detection'],
 array['Blocked drains','Burst pipes','Hot water systems','Leaking taps','Gas fitting','Roof plumbing'],
 array['How soon can someone come?','Is there a call-out fee?','Do you do emergency work?',
       'How much to replace a hot water system?']),

(null, 'carpenter', 'Carpentry',
 'Framing, decking, fit-out and repairs.', true,
 array['framing','stud','noggin','joist','bearer','decking','pergola','architrave','skirting',
       'cladding','lining','trimmer','plate','fascia','soffit','flush panel','second fix'],
 array['Framing','Decking and pergolas','Fit-out','Door and window repairs','Cladding'],
 array['Do you supply timber?','How long will a deck take?','Do you do small jobs?']),

(null, 'landscaper', 'Landscaping',
 'Softscape, hardscape, paving and maintenance.', true,
 array['turf','topsoil','mulch','irrigation','paving','retaining','edging','drainage','ag line',
       'garden bed','excavation','levelling','soft landscaping','hard landscaping'],
 array['Turf laying','Paving','Retaining walls','Irrigation','Garden maintenance'],
 array['When is the best time to lay turf?','Do you remove the old garden?','Do you do maintenance?']),

(null, 'cleaning', 'Cleaning services',
 'Commercial, builder''s clean and end of lease.', true,
 array['builders clean','end of lease','bond clean','high dusting','strip and seal','periodical',
       'scope of works','site induction','consumables','sanitising','pressure wash'],
 array['Builder''s clean','End of lease','Commercial cleaning','Pressure washing','Window cleaning'],
 array['How long does a bond clean take?','Do you bring your own products?','Do you guarantee the bond?']),

(null, 'maintenance', 'Property maintenance',
 'Reactive and scheduled maintenance across trades.', true,
 array['work order','make safe','reactive','scheduled','asset','defect','SLA','response time',
       'planned preventative','call-out','handyman','tenant','make good'],
 array['Reactive repairs','Scheduled maintenance','Make safe','Handyman work','Property inspections'],
 array['What is your response time?','Do you deal with tenants directly?','Do you invoice the agent?']),

(null, 'other', 'General trade',
 'A neutral profile for a trade not listed.', true,
 array['job','site','quote','variation','call-out','scope','make good','defect','completion'],
 array['General trade work'],
 array['How much will it cost?','When can you start?','Do you give a written quote?'])

on conflict (key) where business_id is null
do update set
  name = excluded.name,
  description = excluded.description,
  terminology = excluded.terminology,
  common_services = excluded.common_services,
  common_questions = excluded.common_questions,
  updated_at = now();

-- --- the same self-check as 0003 ------------------------------------------

do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ')
    into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     -- The migration runner's own bookkeeping, locked down in 0003.
     and c.relname <> 'schema_migrations'
     and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid));

  if offenders is not null then
    raise exception 'tables without row level security or without any policy: %', offenders;
  end if;
end $$;
