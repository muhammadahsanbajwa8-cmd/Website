// The unhappy paths, and the notifications.
//
// What happens when the mail provider refuses an invitation, whether the app
// says so instead of claiming success, and whether the things that happen to a
// customer actually reach the customer.
import { chromium } from 'playwright-core';
import postgres from 'postgres';

const APP = 'http://localhost:3310';
const RESEND = 'http://localhost:4599';
const OWNER = { email: 'demo@tradeflow.local', password: 'demo-password-2026' };
const CUSTOMER = { email: 'dana@harbourside.example', password: 'portal-password-2026' };
const SECOND = 'partner@harbourside.example';

const sql = postgres('postgresql://postgres@localhost:55432/postgres', { max: 3, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const [{ id: businessId }] = await sql`select id from businesses where name = 'Demo Construction Services'`;
const [{ id: ownerId }] = await sql`select id from auth.users where email = ${OWNER.email}`;
const [{ id: customerId }] = await sql`
  select id from customers where business_id = ${businessId}::uuid and email = ${CUSTOMER.email}`;

async function asOwner(work) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return work(tx);
  });
}

// Start from a clean slate for the second address.
await sql`delete from customer_users where email = ${SECOND}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-gpu'],
});

async function signIn(page, who) {
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 });
}

const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const op = await ownerCtx.newPage();
await signIn(op, OWNER);

// --- an invitation the provider refuses --------------------------------------
await fetch(`${RESEND}/__fail`);
await op.goto(`${APP}/customers/${customerId}`, { waitUntil: 'domcontentloaded' });
await op.fill('#portalEmail', SECOND);
await op.click('button:has-text("Send invitation")');
await op.waitForTimeout(3000);

const panelText = await op.locator('main').innerText();
check(
  'a refused email is reported, not swallowed',
  panelText.includes('did not go') || panelText.includes('not verified'),
  panelText.split('\n').find((l) => l.includes('did not go')) ?? ''
);
check(
  'and the link is offered instead so the customer is not stranded',
  panelText.includes('/customer-invite/')
);

const [pending] = await sql`
  select invite_token, accepted_at from customer_users where email = ${SECOND}`;
check('the invitation itself still exists', Boolean(pending?.invite_token));
check('and has not been marked as accepted', pending?.accepted_at === null);

// --- a report that cannot be emailed ----------------------------------------
// A title unique to this run, so a previous run's (later resent) report cannot
// make the "never appears" check pass or fail by accident.
const failTitle = `Failure path report ${Date.now()}`;
const [report] = await asOwner((tx) => tx`
  insert into reports (business_id, customer_id, number, title, status)
  values (${businessId}::uuid, ${customerId}::uuid,
          next_document_number(${businessId}::uuid, 'report'), ${failTitle}, 'final')
  returning id, number`);

await op.goto(`${APP}/reports/${report.id}`, { waitUntil: 'domcontentloaded' });
await op.click('button:has-text("Send report")');
await op.waitForTimeout(3000);

const reportText = await op.locator('main').innerText();
check(
  'a report that could not be sent says so',
  reportText.includes('could') || reportText.includes('not verified'),
  reportText.split('\n').find((l) => /could|not verified/.test(l)) ?? ''
);

const [failed] = await sql`select sent_at, send_error, status from reports where id = ${report.id}::uuid`;
check('and is NOT marked as sent', failed.sent_at === null, String(failed.sent_at));
check('with the provider’s reason kept against it', Boolean(failed.send_error), failed.send_error ?? '');

// The customer must not be shown a report that never went.
const custCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const cp = await custCtx.newPage();
await signIn(cp, CUSTOMER);
await cp.goto(`${APP}/portal/reports`, { waitUntil: 'domcontentloaded' });
check(
  'and never appears in the customer’s account',
  !(await cp.locator('main').innerText()).includes(failTitle)
);

// --- and when the provider is working again ---------------------------------
await fetch(`${RESEND}/__ok`);
await op.reload({ waitUntil: 'domcontentloaded' });
await op.click('button:has-text("Send report")');
await op.waitForTimeout(3000);
const [resent] = await sql`select sent_at, send_error from reports where id = ${report.id}::uuid`;
check('a retry after the provider recovers goes through', Boolean(resent.sent_at));
check('and the old error is cleared', resent.send_error === null, String(resent.send_error));

// --- notifications reach the customer ---------------------------------------
await cp.goto(`${APP}/portal`, { waitUntil: 'domcontentloaded' });
await cp.click('button[aria-label*="Notification"]');
await cp.waitForTimeout(1200);
const bell = await cp.locator('body').innerText();
check(
  'the customer is told their report was sent',
  bell.includes('sent you a report'),
  bell.split('\n').find((l) => l.includes('report')) ?? ''
);

// Booking one in notifies them too.
const [bookedJob] = await asOwner((tx) => tx`
  insert into jobs (business_id, customer_id, number, name, status)
  values (${businessId}::uuid, ${customerId}::uuid,
          next_document_number(${businessId}::uuid, 'job'), 'Gutter clean', 'accepted')
  returning id`);
await op.goto(`${APP}/jobs/${bookedJob.id}`, { waitUntil: 'domcontentloaded' });
const scheduleButton = await op.locator('button:has-text("Scheduled")').count();
if (scheduleButton > 0) {
  await op.locator('button:has-text("Scheduled")').first().click();
  await op.waitForTimeout(2500);
}
const [booking] = await sql`
  select count(*)::int as n from notifications
   where business_id = ${businessId}::uuid and kind = 'booking.scheduled'`;
check(
  'booking a job in notifies the customer',
  scheduleButton > 0 && booking.n > 0,
  `${booking.n} notification(s)`
);

// A customer never sees another customer's notification.
const [{ id: otherCustomer }] = await sql`
  select id from customers where business_id = ${businessId}::uuid and id <> ${customerId}::uuid limit 1`;
await sql`
  insert into notifications (business_id, user_id, kind, title)
  select ${businessId}::uuid, ${ownerId}::uuid, 'test.private', 'Owner only note'`;
await cp.reload({ waitUntil: 'domcontentloaded' });
await cp.click('button[aria-label*="Notification"]');
await cp.waitForTimeout(1000);
check(
  'and never somebody else’s',
  !(await cp.locator('body').innerText()).includes('Owner only note'),
  otherCustomer
);

await browser.close();
await sql.end();

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
if (failedChecks.length) {
  console.log('failed:');
  for (const f of failedChecks) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
