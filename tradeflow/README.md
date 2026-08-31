# TradeFlow

**Run your entire trade business from one place.**

Jobs, customers, leads, estimates, quotes, invoices, payments, site reports,
photos, timesheets, receipts, materials, documents, email and an AI phone agent
— one application, built for builders, contractors, subcontractors and every
other trade that runs work in the field and bills for it afterwards.

Australian by default: AUD, GST, ABN, BSB, `dd/mm/yyyy`, and dates that respect
`Australia/Sydney` rather than whatever timezone the server happens to be in.

---

## Getting it running

You need a Supabase project (the free tier is enough) and Node 20 or newer.

```bash
cd tradeflow
npm install
npm run setup        # writes .env.local, then checks everything it can
npm run dev          # http://localhost:3000
```

`npm run setup` is the whole onboarding. It copies `.env.example` to
`.env.local`, tells you which values are still missing and exactly where in the
Supabase dashboard each one is found, then — once they are filled in — connects
to the database, applies the migrations, confirms row level security is on
every table, and confirms the storage buckets exist.

To see the product with work already in it:

```bash
npm run db:seed              # a demo login with a business already running
npm run db:seed -- --clear   # and remove it again
```

That creates `demo@tradeflow.local` / `demo-password-2026` with customers, jobs
at four different stages, an accepted quote, an invoice part paid, another
overdue, a site report, a timesheet, receipts and a configured phone assistant.
A fuller worked example can also be loaded from inside the app, into whichever
business you are in, at **Settings → Demo data** — everything it creates is
marked `[demo]` and the same page takes it all back out again without touching
anything you entered yourself.

### The values you have to provide

Four are required, and all four come from your own Supabase project:

| Variable | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → anon |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → service_role |
| `DATABASE_URL` | Project Settings → Database → Connection string → URI |

Everything else is optional and degrades on its own. With none of it set, the
whole platform still runs — jobs, quotes, invoices, PDFs, reports, photos,
timesheets and all — and each unconfigured feature says which variable it is
waiting for instead of failing.

| Variable | Turns on | Without it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | the business assistant, the email helper, the phone agent | the AI panels explain that a key is needed |
| `EMAIL_PROVIDER` + `RESEND_API_KEY` or `SMTP_URL` | actually delivering email | mail is composed, recorded in the outbox and logged, but not sent |
| `TWILIO_AUTH_TOKEN` + a phone number | answering the phone | the voice webhooks refuse every request |

One credential genuinely cannot be created for you: **a phone number** has to
be bought on an account in your name. Everything either side of it is done —
the webhook handling, the signature verification, the conversation, the
after-call processing — but the number itself is yours to obtain.

### Not implemented

**Connecting an existing mailbox.** Outbound email is complete: quotes,
invoices and reports are composed, sent and recorded against the job, and the
AI drafts replies. The inbound half — signing in to Gmail or Outlook so
received messages land on the job they belong to — is not written. The schema,
the encrypted token columns and the interface are all in place, and the app
says so plainly on the Emails page rather than pretending otherwise, but the
OAuth callback and the sync are still to do. `GOOGLE_OAUTH_*` and
`MICROSOFT_OAUTH_*` in `.env.example` are reserved for it.

**Billing.** The pricing page is real and the plans are on the business row,
but nothing charges anyone. That was deliberate: the brief said to leave
billing until the core works.

---

## What is in it

**Work** — a dashboard with real figures, jobs through eleven states, tasks,
site reports from eleven templates (daily site, progress, defect, safety,
inspection, variation, security incident, patrol, maintenance, service,
handover), photos taken on a phone, and daily work logs that total their own
hours.

**Money** — an estimating calculator across labour, materials, equipment,
travel, subcontractors and other costs, with markup, contingency and GST;
estimates that become quotes; quotes that become invoices; payments, expenses,
materials, suppliers, and job profitability that reconciles against all of it.

**Customers** — customers and their contacts, leads through a pipeline, a
customer portal where a quote can be read, downloaded, accepted, declined or
queried without an account, and the same for invoices.

**Communication** — email with attachments generated from the live record, an
AI assistant that summarises, drafts and shortens (and never sends — every
draft waits for a person to press send), and a phone agent that answers in the
business's own voice, knows the trade's vocabulary, recognises a returning
caller, and turns the call into structured follow-up work afterwards.

**Everything else** — five roles, notifications, an audit log, documents, and
a mobile layout built so a worker can file a site report from a phone in under
a minute.

---

## How it is built

Next.js 16 (App Router, server components, server actions), React 19,
TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, Storage), the Anthropic
API for the AI features, and pdf-lib for documents. No ORM: the schema is SQL,
and the row types are written against it.

```
supabase/migrations/   the database, in five files, applied by npm run db:push
src/lib/               money, calculations, permissions, PDF, email, AI, voice
src/app/(app)/         the application itself, one directory per section
src/app/q|i/[token]/   the customer portal — no account, no session
src/app/api/voice/     the telephony webhooks
tests/                 385 tests, including the tenancy suite below
```

### Money is never a float

Every amount is an integer number of cents (`bigint`), every quantity is
thousandths. A quote's arithmetic is written twice — once in TypeScript for the
browser and the server action, once in SQL for the trigger that keeps the
denormalised totals right — and the tests check the two against each other. A
`numeric` or a JavaScript `number` in the middle of that would round
differently in the two places, and the difference would show up on an invoice.

### Tenancy is the database's job, not the application's

*Can Business A access Business B's data?* **No** — and not because every page
remembers to filter.

Every business-owned table has row level security enabled *and forced*, and
every policy bottoms out in one predicate:

```sql
create function app_is_member(target uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from team_members tm
    where tm.business_id = target and tm.user_id = auth.uid()
      and tm.deleted_at is null and tm.accepted_at is not null
  );
$$;
```

There is no "authenticated users can read" policy anywhere in the schema, and
`anon` is stripped of table privileges entirely — the customer portal reaches
its three functions and nothing else. The last statement of the RLS migration
raises an exception if any table in `public` lacks a policy, so a table added
without one fails the deploy rather than shipping open.

The application filters by business id as well. That is belt and braces: RLS is
the boundary; the filter is so a mistake fails loudly rather than widely.

Priced work goes further. The `worker` role is excluded from the policies on
estimates, quotes, invoices and payments, so a labourer with an app login
cannot read what a job was quoted at — the database refuses, not the interface.

### The AI cannot be argued into another tenant

A phone caller has no session. The business is established from the number that
was dialled, and every tool the model can reach closes over that one business
id. No tool takes a business id as an argument, so there is no argument the
model can produce that reaches another tenant's data — and a test asserts that
no tool schema ever grows one.

Two more rules are structural rather than prompted: the assistant never sends
email (there is no code path from an AI action to a send), and what a call
produces is *proposed* — it lands in `call_actions` and a person presses the
button, so speech misheard on a noisy site never silently becomes a job.

---

## Testing

```bash
npm test          # the full suite
npm run typecheck
npm run check     # both
```

385 tests. The interesting ones are not the unit tests:

- **`tests/tenancy.test.ts`** reads the migrations and asserts the guarantee
  above — RLS on and forced everywhere, every policy scoped to the caller,
  nothing open to `public` or `anon`, no `using (true)`, every SECURITY DEFINER
  function pinning its `search_path`, the portal reachable only by token, no AI
  tool accepting a business id, and no page querying the database without
  establishing a session first.
- **`tests/tenancy.live.test.ts`** proves it end to end against a real
  database: two businesses, two owners, and then every way one could try to
  reach the other — reading by id, filtering by the other business id,
  updating, deleting, inserting a row carrying someone else's business id,
  joining their team. All refused. It also checks that a `worker` in a business
  sees its customers but none of its quotes or invoices.
- **`tests/permissions.test.ts`** parses the role sets out of the SQL and
  compares them with the capability table the interface uses, so the two cannot
  drift apart unnoticed.
- **`tests/schema.test.ts`** compares every column in the migrations against
  the hand-written row types, and checks no money column is a float.

The live suite needs a database. It skips loudly without one:

```bash
DATABASE_URL=postgresql://… npx vitest run tests/tenancy.live.test.ts
```

CI runs it against a plain Postgres container, using
`supabase/ci/bootstrap.sql` to stand up the small parts of Supabase the
migrations depend on (`auth.users`, `auth.uid()`, the storage tables). That
file is for CI only — a real project already has richer versions of all of it.

---

## Deploying

Any host that runs Next.js. Set the same environment variables, point
`NEXT_PUBLIC_APP_URL` at the real domain (quote share links and auth redirects
are built from it), and run the migrations against the production database:

```bash
npm run db:push
```

Migrations are re-runnable and recorded with a checksum, so applying them twice
is a no-op and a file edited after being applied is reported rather than
silently skipped.

For the phone agent, point your number's voice webhook at
`https://your-domain/api/voice/incoming` and its status callback at
`/api/voice/status`, both HTTP POST. Every request is checked against the
Twilio signature in constant time; with no auth token configured the routes
refuse everything rather than answering an unauthenticated call.
