#!/usr/bin/env node
// ---------------------------------------------------------------------------
// seed-demo — create a demo business you can sign into straight away.
//
//   npm run db:seed              create (or top up) the demo account
//   npm run db:seed -- --clear   remove it entirely
//
// It creates one login, one business, and enough work to make every screen
// show something: customers, jobs at different stages, a quote that was
// accepted, an invoice part paid and another overdue, a site report, a
// timesheet, receipts, tasks, and a filled-in phone assistant.
//
// The business is flagged `is_demo`, every record it writes is tagged [demo],
// and --clear removes exactly those. Nothing here touches a real account.
//
// A fuller worked example is also available inside the app, at
// Settings → Demo data, which loads into whichever business you are in.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from './env.mjs';

loadEnv();

const EMAIL = process.env.DEMO_EMAIL || 'demo@tradeflow.local';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo-password-2026';
const BUSINESS = 'Demo Construction Services';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Copy .env.example to .env.local and fill it in, or run `npm run setup`.'
  );
  process.exit(1);
}

const clear = process.argv.slice(2).includes('--clear');

const sql = postgres(url, {
  max: 1,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : 'require',
  onnotice: () => {},
});

/** Today, and dates around it, in the format the date columns want. */
const day = (offset) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

async function removeDemo() {
  const [business] = await sql`select id from businesses where is_demo and name = ${BUSINESS}`;
  if (business) {
    // Everything cascades from the business row.
    await sql`delete from businesses where id = ${business.id}`;
  }
  await sql`delete from auth.users where email = ${EMAIL}`;
  console.log(business ? '· demo business removed' : '· nothing to remove');
}

async function seed() {
  // --- the login ------------------------------------------------------------
  // bcrypt via pgcrypto, which Supabase's auth schema already relies on.
  const [user] = await sql`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    values (
      ${randomUUID()}::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', ${EMAIL}, crypt(${PASSWORD}, gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      ${sql.json({ full_name: 'Alex Demo' })}, now(), now()
    )
    on conflict (email) do update set updated_at = now()
    returning id`;

  const userId = user.id;

  await sql`
    insert into profiles (id, email, full_name)
    values (${userId}::uuid, ${EMAIL}, 'Alex Demo')
    on conflict (id) do update set full_name = excluded.full_name`;

  // --- the business ---------------------------------------------------------
  const existing = await sql`select id from businesses where is_demo and name = ${BUSINESS}`;
  if (existing.length) {
    console.log('· demo business already exists — leaving it as it is');
    console.log(`\n  sign in:  ${EMAIL}\n  password: ${PASSWORD}\n`);
    return;
  }

  const [business] = await sql`
    insert into businesses (
      name, business_type, abn, email, phone, address_line1, suburb, state, postcode,
      gst_registered, default_payment_terms_days, bank_account_name, bank_bsb,
      bank_account_number, is_demo, onboarded_at
    )
    values (
      ${BUSINESS}, 'Bricklaying & general construction', '51824753556',
      'accounts@democonstruction.example', '(02) 9555 0100', '12 Foundry Lane',
      'Alexandria', 'NSW', '2015', true, 14, ${BUSINESS}, '062000', '10029384',
      true, now()
    )
    returning id`;

  const businessId = business.id;

  await sql`
    insert into team_members (business_id, user_id, email, full_name, role, accepted_at)
    values (${businessId}::uuid, ${userId}::uuid, ${EMAIL}, 'Alex Demo', 'owner', now())`;

  // From here on the connection claims to be the demo owner, so the functions
  // that check membership — document numbering among them — behave exactly as
  // they will for that person in the browser.
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({
    sub: userId,
    role: 'authenticated',
  })}, false)`;

  const number = async (kind) => {
    const [row] = await sql`select next_document_number(${businessId}::uuid, ${kind}) as n`;
    return row.n;
  };

  // --- customers ------------------------------------------------------------
  const customers = await sql`
    insert into customers (business_id, name, company, email, phone, suburb, state, postcode, notes)
    values
      (${businessId}::uuid, 'Dana Whitfield', 'Harbourside Property Group',
       'dana@harbourside.example', '0412 555 108', 'Pyrmont', 'NSW', '2009',
       '[demo] Prefers a call to an email.'),
      (${businessId}::uuid, 'Marcus Iereti', null, 'marcus@example.com',
       '0403 771 226', 'Marrickville', 'NSW', '2204',
       '[demo] Owner-builder. Dog in the yard.'),
      (${businessId}::uuid, 'Priya Raman', 'Corvus Construction', 'priya@corvus.example',
       '0455 902 310', 'Camperdown', 'NSW', '2050', '[demo] Repeat commercial client.')
    returning id, name`;

  const [dana, marcus, priya] = customers;

  // --- jobs -----------------------------------------------------------------
  const jobs = [];
  for (const job of [
    {
      customer: dana.id,
      name: 'Boundary wall — 88 Wharf Road',
      status: 'in_progress',
      start: day(-12),
      finish: day(6),
      budget: 4_850_00,
      suburb: 'Pyrmont',
    },
    {
      customer: marcus.id,
      name: 'Garage slab and piers',
      status: 'scheduled',
      start: day(9),
      finish: day(20),
      budget: 12_400_00,
      suburb: 'Marrickville',
    },
    {
      customer: priya.id,
      name: 'Face brickwork — Stage 2',
      status: 'completed',
      start: day(-48),
      finish: day(-9),
      budget: 31_500_00,
      suburb: 'Camperdown',
    },
    {
      customer: dana.id,
      name: 'Retaining wall — rear courtyard',
      status: 'estimating',
      start: null,
      finish: null,
      budget: null,
      suburb: 'Pyrmont',
    },
  ]) {
    const [row] = await sql`
      insert into jobs (
        business_id, customer_id, number, name, status, start_date,
        expected_completion_date, budget_cents, site_suburb, site_state, notes, created_by
      )
      values (
        ${businessId}::uuid, ${job.customer}::uuid, ${await number('job')}, ${job.name},
        ${job.status}::job_status, ${job.start}, ${job.finish}, ${job.budget},
        ${job.suburb}, 'NSW', '[demo] Seeded example job.', ${userId}::uuid
      )
      returning id, name`;
    jobs.push(row);
  }

  // --- a quote that was accepted -------------------------------------------
  const [quote] = await sql`
    insert into quotes (
      business_id, customer_id, job_id, number, status, title, scope_of_work,
      issue_date, expiry_date, accepted_at, accepted_by_name, sent_at, created_by
    )
    values (
      ${businessId}::uuid, ${priya.id}::uuid, ${jobs[2].id}::uuid, ${await number('quote')},
      'accepted', 'Face brickwork — Stage 2',
      '[demo] Supply and lay face brickwork to the northern elevation, including scaffold.',
      ${day(-56)}, ${day(-26)}, ${day(-50)}, 'Priya Raman', ${day(-55)}, ${userId}::uuid
    )
    returning id`;

  await sql`
    insert into quote_items (business_id, quote_id, description, quantity_milli, unit, unit_price_cents, position)
    values
      (${businessId}::uuid, ${quote.id}::uuid, 'Face brickwork, supply and lay', 210000, 'm2', 14500, 0),
      (${businessId}::uuid, ${quote.id}::uuid, 'Scaffold hire', 4000, 'week', 42000, 1),
      (${businessId}::uuid, ${quote.id}::uuid, 'Site clean and cart away', 1000, 'item', 95000, 2)`;

  // --- invoices: one part paid, one overdue --------------------------------
  const [partPaid] = await sql`
    insert into invoices (
      business_id, customer_id, job_id, quote_id, number, status, title,
      issue_date, due_date, notes, sent_at, created_by
    )
    values (
      ${businessId}::uuid, ${priya.id}::uuid, ${jobs[2].id}::uuid, ${quote.id}::uuid,
      ${await number('invoice')}, 'sent', 'Face brickwork — Stage 2',
      ${day(-14)}, ${day(7)}, '[demo] Progress claim 2 of 3.', ${day(-14)}, ${userId}::uuid
    )
    returning id`;

  await sql`
    insert into invoice_items (business_id, invoice_id, description, quantity_milli, unit, unit_price_cents, position)
    values
      (${businessId}::uuid, ${partPaid.id}::uuid, 'Face brickwork, progress claim', 1000, 'item', 1850000, 0)`;

  await sql`
    insert into payments (business_id, invoice_id, amount_cents, method, paid_on, reference, notes, created_by)
    values (${businessId}::uuid, ${partPaid.id}::uuid, 1000000, 'bank_transfer', ${day(-6)},
            'EFT 88213', '[demo] Part payment received.', ${userId}::uuid)`;

  const [overdue] = await sql`
    insert into invoices (
      business_id, customer_id, job_id, number, status, title,
      issue_date, due_date, notes, sent_at, created_by
    )
    values (
      ${businessId}::uuid, ${dana.id}::uuid, ${jobs[0].id}::uuid, ${await number('invoice')},
      'sent', 'Boundary wall — deposit', ${day(-45)}, ${day(-31)},
      '[demo] Deposit invoice, now past due.', ${day(-45)}, ${userId}::uuid
    )
    returning id`;

  await sql`
    insert into invoice_items (business_id, invoice_id, description, quantity_milli, unit, unit_price_cents, position)
    values (${businessId}::uuid, ${overdue.id}::uuid, 'Deposit — 30%', 1000, 'item', 145500, 0)`;

  await sql`select mark_overdue_invoices(${businessId}::uuid)`;

  // --- a day on site --------------------------------------------------------
  await sql`
    insert into work_logs (
      business_id, job_id, work_date, start_time, finish_time, break_minutes,
      worker_count, work_completed, weather, created_by
    )
    values (
      ${businessId}::uuid, ${jobs[0].id}::uuid, ${day(-1)}, '07:00', '15:30', 30, 3,
      '[demo] Laid to course 14 on the western return. Set out for the return corner.',
      'Fine, 24°C', ${userId}::uuid
    )`;

  // --- a site report --------------------------------------------------------
  const [template] = await sql`
    select id from report_templates where business_id is null and key = 'daily_site' limit 1`;

  if (template) {
    await sql`
      insert into reports (
        business_id, template_id, template_key, job_id, customer_id, number, title,
        report_date, status, summary, created_by
      )
      values (
        ${businessId}::uuid, ${template.id}::uuid, 'daily_site', ${jobs[0].id}::uuid,
        ${dana.id}::uuid, ${await number('report')},
        'Daily site report — boundary wall', ${day(-1)}, 'final',
        '[demo] Three on site. Bricks delivered 9am. No incidents.', ${userId}::uuid
      )`;
  }

  // --- receipts and tasks ---------------------------------------------------
  await sql`
    insert into expenses (business_id, job_id, description, category, amount_cents, gst_cents, spent_on, notes, created_by)
    values
      (${businessId}::uuid, ${jobs[0].id}::uuid, 'Bricks — 2,400 commons', 'materials', 264000, 24000, ${day(-11)}, '[demo]', ${userId}::uuid),
      (${businessId}::uuid, ${jobs[0].id}::uuid, 'Mixer hire, one week', 'equipment', 18500, 1682, ${day(-8)}, '[demo]', ${userId}::uuid),
      (${businessId}::uuid, ${jobs[2].id}::uuid, 'Scaffold hire', 'equipment', 168000, 15273, ${day(-40)}, '[demo]', ${userId}::uuid)`;

  await sql`
    insert into job_tasks (business_id, job_id, title, description, status, priority, due_date, created_by)
    values
      (${businessId}::uuid, ${jobs[0].id}::uuid, 'Order more bricks', '[demo] Another pallet for the return.', 'open', 'high', ${day(1)}, ${userId}::uuid),
      (${businessId}::uuid, ${jobs[1].id}::uuid, 'Confirm concrete pour', '[demo] Book the truck for the 9th.', 'open', 'urgent', ${day(2)}, ${userId}::uuid),
      (${businessId}::uuid, ${jobs[2].id}::uuid, 'Chase final payment', '[demo] Invoice is past due.', 'in_progress', 'medium', ${day(-2)}, ${userId}::uuid)`;

  // --- the phone assistant --------------------------------------------------
  await sql`select ensure_ai_brain(${businessId}::uuid)`;
  await sql`
    update ai_brain set
      industry_key = 'bricklayer',
      tone = 'friendly',
      services = array['Face and common brickwork', 'Block walls', 'Retaining walls', 'Repointing'],
      service_area = 'Inner West and inner Sydney, up to 25km from Alexandria',
      business_hours = ${sql.json({
        monday: '7:00am–4:00pm',
        tuesday: '7:00am–4:00pm',
        wednesday: '7:00am–4:00pm',
        thursday: '7:00am–4:00pm',
        friday: '7:00am–3:00pm',
        saturday: 'By arrangement',
        sunday: 'Closed',
      })},
      escalation_name = 'Alex',
      escalation_phone = '0412 000 000',
      forbidden_topics = array['insurance claims', 'legal disputes', 'other customers'' jobs'],
      may_discuss_pricing = false,
      may_confirm_bookings = false,
      may_share_job_status = true,
      enabled = true
    where business_id = ${businessId}::uuid`;

  await sql`
    insert into ai_faqs (business_id, question, answer, position)
    values
      (${businessId}::uuid, 'Do you do weekend work?', 'Saturday mornings by arrangement. Sundays we are closed.', 0),
      (${businessId}::uuid, 'Do you supply the bricks?', 'Yes, we can supply and lay, or lay bricks you have already bought.', 1),
      (${businessId}::uuid, 'Can you match existing bricks?', 'Usually. A photo of the existing wall helps us find the closest match.', 2)`;

  console.log(`\n  Demo business seeded: ${BUSINESS}`);
  console.log(`\n  sign in:  ${EMAIL}\n  password: ${PASSWORD}\n`);
  console.log('  Remove it again with:  npm run db:seed -- --clear\n');
}

try {
  if (clear) await removeDemo();
  else await seed();
} catch (error) {
  console.error(`\nSeeding failed: ${error.message}`);
  if (error.hint) console.error(`  hint: ${error.hint}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
