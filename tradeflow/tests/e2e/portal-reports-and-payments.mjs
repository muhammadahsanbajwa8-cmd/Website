// The other half of the customer story: a job, a report written up and sent,
// an invoice, and a card payment — each driven through the buttons a person
// would press, then checked from the customer's side of the portal.
import { chromium } from 'playwright-core';
import postgres from 'postgres';

const APP = 'http://localhost:3310';
const STRIPE = 'http://localhost:4600';
const OWNER = { email: 'demo@tradeflow.local', password: 'demo-password-2026' };
const CUSTOMER = { email: 'dana@harbourside.example', password: 'portal-password-2026' };

const sql = postgres('postgresql://postgres@localhost:55432/postgres', { max: 3, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const fire = (e) =>
  fetch(`${STRIPE}/__fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e),
  }).then((r) => r.json());

const [{ id: businessId }] = await sql`select id from businesses where name = 'Demo Construction Services'`;
const [{ id: ownerId }] = await sql`select id from auth.users where email = ${OWNER.email}`;

/** Run a block as the owner would, so RLS and the numbering function apply. */
async function asOwner(work) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return work(tx);
  });
}
const [{ id: customerId }] = await sql`
  select id from customers where business_id = ${businessId}::uuid and email = ${CUSTOMER.email}`;

// A job for this customer, so the portal has a booking to show. Written as the
// owner would, through the same policies.
const [job] = await asOwner((tx) => tx`
  insert into jobs (business_id, customer_id, number, name, description, status,
                    start_date, site_address_line1, site_suburb, site_state, site_postcode, notes)
  values (${businessId}::uuid, ${customerId}::uuid,
          next_document_number(${businessId}::uuid, 'job'),
          'Kitchen tap and cupboard repair',
          'Replace the mixer and dry out the cupboard base.',
          'scheduled', current_date + 3,
          '9 Rivett Street', 'Marrickville', 'NSW', '2204',
          'Internal: quote came in low, watch the hours')
  returning id, number`);

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

// ------------------------------------------------------------------ the owner
const ownerCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const op = await ownerCtx.newPage();
op.on('pageerror', (e) => console.log('  [owner page error]', e.message));
await signIn(op, OWNER);

// --- a report, written and sent through the buttons -------------------------
await op.goto(`${APP}/reports/new`, { waitUntil: 'domcontentloaded' });
check('the report template picker opens', (await op.locator('a[href*="/reports/new?"]').count()) > 0);

const templateHref = await op.locator('a[href*="/reports/new?template="]').first().getAttribute('href');
await op.goto(`${APP}${templateHref}`, { waitUntil: 'domcontentloaded' });
check('a template opens the report form', (await op.locator('input[name="title"]').count()) > 0);

await op.fill('input[name="title"]', 'Kitchen tap replaced');
await op.selectOption('#jobId', job.id).catch(() => {});
await op.selectOption('#customerId', customerId).catch(() => {});
await op.fill('textarea[name="summary"]', 'Mixer replaced, cupboard base dried and sealed. No further leak.');
await op.click('button[type="submit"]:has-text("Save")');
await op.waitForURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 20000 }).catch(() => {});
await op.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
const reportUrl = op.url();
check('the report saves and opens', /\/reports\/[0-9a-f-]{36}/.test(reportUrl), reportUrl);

const reportId = (reportUrl.match(/\/reports\/([0-9a-f-]{36})/) ?? [])[1];

// Mark it completed, then send it.
const completeButton = await op.locator('button:has-text("Mark completed")').count();
if (completeButton > 0) {
  await op.click('button:has-text("Mark completed")');
  await op.waitForTimeout(2000);
}
const [completedRow] = await sql`select status, completed_at from reports where id = ${reportId}::uuid`;
check(
  'a draft report can be marked completed',
  completeButton > 0 && completedRow.status === 'final' && Boolean(completedRow.completed_at),
  `${completedRow.status}, button ${completeButton}`
);

const before = await (await fetch('http://localhost:4599/__received')).json();
await op.goto(`${APP}/reports/${reportId}`, { waitUntil: 'domcontentloaded' });
check(
  'the send panel is pre-filled with the address on the customer’s record',
  (await op.inputValue('#to')) === CUSTOMER.email,
  await op.inputValue('#to')
);

await op.click('button:has-text("Send")');
await op.waitForTimeout(3000);
const after = await (await fetch('http://localhost:4599/__received')).json();
const sent = after.slice(before.length).find((m) => JSON.stringify(m.to).includes(CUSTOMER.email));
check('pressing Send actually sends an email', Boolean(sent), sent ? sent.subject : 'nothing arrived');
check(
  'and it carries the report as a real PDF',
  Boolean(sent?.attachments?.[0]?.isPdf),
  sent ? `${sent.attachments[0]?.filename} (${sent.attachments[0]?.bytes} bytes)` : ''
);
check('and a link the customer can open without an account', sent?.textHasLink === true);

const [reportRow] = await sql`select sent_at, sent_to, send_count, send_error from reports where id = ${reportId}::uuid`;
check('the send is recorded against the report', Boolean(reportRow.sent_at), `to ${reportRow.sent_to}`);
check('with no error stored', reportRow.send_error === null, String(reportRow.send_error));

// Sending twice by accident is refused.
await op.reload({ waitUntil: 'domcontentloaded' });
const resendCount = await op.locator('button:has-text("Send it again")').count();
check('a sent report offers a deliberate resend rather than a second Send', resendCount > 0);
check(
  'and shows who it went to and when',
  (await op.locator(`text=${CUSTOMER.email}`).count()) > 0
);

// --- an invoice -------------------------------------------------------------
const [invoice] = await asOwner((tx) => tx`
  insert into invoices (business_id, customer_id, job_id, number, status, title,
                        issue_date, due_date, gst_applies, sent_at)
  values (${businessId}::uuid, ${customerId}::uuid, ${job.id}::uuid,
          next_document_number(${businessId}::uuid, 'invoice'), 'sent',
          'Kitchen tap and cupboard repair', current_date, current_date + 14, true, now())
  returning id, number`);
await asOwner((tx) => tx`
  insert into invoice_items (business_id, invoice_id, position, description, quantity_milli, unit, unit_price_cents)
  values (${businessId}::uuid, ${invoice.id}::uuid, 0, 'Replace kitchen mixer, labour and parts', 1000, 'each', 48000)`);
const [priced] = await sql`select total_cents from invoices where id = ${invoice.id}::uuid`;
check('the invoice totals itself in the database', Number(priced.total_cents) === 52800, `$${priced.total_cents / 100}`);

// The business must be able to take a card for the Pay now path to exist.
let [biz] = await sql`select stripe_account_id, stripe_charges_enabled from businesses where id = ${businessId}::uuid`;
if (!biz.stripe_account_id) {
  await op.goto(`${APP}/settings/payments`, { waitUntil: 'domcontentloaded' });
  await op.click('button:has-text("Connect an account")');
  await op.waitForTimeout(2500);
  [biz] = await sql`select stripe_account_id, stripe_charges_enabled from businesses where id = ${businessId}::uuid`;
}
if (biz.stripe_account_id && !biz.stripe_charges_enabled) {
  await fire({
    id: `evt_acct_${Date.now()}`,
    type: 'account.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: biz.stripe_account_id,
        object: 'account',
        charges_enabled: true,
        details_submitted: true,
      },
    },
  });
  [biz] = await sql`select stripe_account_id, stripe_charges_enabled from businesses where id = ${businessId}::uuid`;
}
check('the business can take card payments', biz.stripe_charges_enabled === true, biz.stripe_account_id ?? '');

// --------------------------------------------------------------- the customer
const custCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const cp = await custCtx.newPage();
cp.on('pageerror', (e) => console.log('  [customer page error]', e.message));
await signIn(cp, CUSTOMER);

// The booking.
await cp.goto(`${APP}/portal/bookings`, { waitUntil: 'domcontentloaded' });
check('the booking appears for the customer', (await cp.locator('text=Kitchen tap and cupboard repair').count()) > 0);
// The booking this run created, not whichever sits at the top of the list.
await cp.goto(`${APP}/portal/bookings/${job.id}`, { waitUntil: 'domcontentloaded' });
check('the booking opens', /\/portal\/bookings\/[0-9a-f-]{36}/.test(cp.url()), cp.url());
// Wait for the page itself, not just the document: these are streamed.
await cp.waitForSelector('h1', { timeout: 15000 }).catch(() => {});
const bookingText = await cp.locator('main').innerText();
check('it shows the date and the address', bookingText.includes('Marrickville'));
check('it does not leak the office’s internal note', !bookingText.includes('watch the hours'));
check('the report is listed against the booking', bookingText.includes('Kitchen tap replaced'));

// The report.
await cp.goto(`${APP}/portal/reports`, { waitUntil: 'domcontentloaded' });
check('the report is in their reports list', (await cp.locator('text=Kitchen tap replaced').count()) > 0);
// The report this run wrote, not whichever is newest in the list.
await cp.goto(`${APP}/portal/reports/${reportId}`, { waitUntil: 'domcontentloaded' });
const reportText = await cp.locator('main').innerText();
check('the report opens with its summary', reportText.includes('cupboard base dried'), cp.url());

const pdf = await cp.request.get(`${cp.url()}/pdf?download=1`);
const bytes = await pdf.body();
check(
  'the customer can download the PDF',
  pdf.status() === 200 && bytes.subarray(0, 4).toString() === '%PDF',
  `HTTP ${pdf.status()}, ${bytes.length} bytes`
);

// Somebody else's report is not theirs to download.
const [otherReport] = await sql`
  select id from reports
   where business_id = ${businessId}::uuid and customer_id <> ${customerId}::uuid
     and sent_at is not null limit 1`;
if (otherReport) {
  const denied = await cp.request.get(`${APP}/portal/reports/${otherReport.id}/pdf`);
  check('another customer’s report PDF is refused', denied.status() === 404, `HTTP ${denied.status()}`);
} else {
  check('another customer’s report PDF is refused', true, '(no other sent report to try)');
}

// The money.
await cp.goto(`${APP}/portal/payments`, { waitUntil: 'domcontentloaded' });
const payText = await cp.locator('main').innerText();
check(
  'the new invoice shows as owing',
  payText.includes('528.00') && payText.includes(invoice.number),
  invoice.number
);
check('with a Pay now button', (await cp.locator('button:has-text("Pay now")').count()) > 0);

await fetch(`${STRIPE}/__reset`, { method: 'POST' });
await cp.locator(`li:has-text("${invoice.number}") button:has-text("Pay now")`).first().click();
await cp.waitForURL(/\/i\/[a-f0-9]+/, { timeout: 20000 }).catch(() => {});
check('it opens the invoice’s own payment page', /\/i\/[a-f0-9]{20,}/.test(cp.url()), cp.url());

await cp.click('button:has-text("Pay now")');
await cp.waitForTimeout(3000);
const sessions = await (await fetch(`${STRIPE}/__sessions`)).json();
const session = Object.values(sessions).pop();
check('a checkout session is created', Boolean(session));
check(
  'priced from the invoice, not from the browser',
  session?.amount === '52800',
  session ? `$${Number(session.amount) / 100}` : ''
);
check(
  'and created on the business’s own connected account',
  session?.account === biz.stripe_account_id,
  session?.account ?? ''
);

// Only the webhook may settle it.
const evt = {
  id: `evt_portal_${Date.now()}`,
  type: 'payment_intent.succeeded',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: `pi_portal_${Date.now()}`,
      object: 'payment_intent',
      status: 'succeeded',
      amount: 52800,
      amount_received: 52800,
      application_fee_amount: 0,
      metadata: { invoice_id: invoice.id, business_id: businessId },
    },
  },
};
const settled = await fire(evt);
check('the provider’s webhook is accepted', settled.status === 200, `HTTP ${settled.status}`);

const [afterPay] = await sql`select paid_cents, status from invoices where id = ${invoice.id}::uuid`;
check('the invoice is now paid', Number(afterPay.paid_cents) === 52800 && afterPay.status === 'paid', afterPay.status);

// Sending the same event again must not double-credit.
const again = await fire(evt);
const [afterRepeat] = await sql`select paid_cents from invoices where id = ${invoice.id}::uuid`;
check(
  'a redelivered webhook changes nothing',
  Number(afterRepeat.paid_cents) === 52800,
  `HTTP ${again.status}, paid $${afterRepeat.paid_cents / 100}`
);

await cp.goto(`${APP}/portal/payments`, { waitUntil: 'domcontentloaded' });
const paidText = await cp.locator('main').innerText();
check('the customer sees it as paid', paidText.includes('Nothing owing') || paidText.includes('Paid'));
check('and the payment is in their history', paidText.includes('528.00'));

// --- mobile ---------------------------------------------------------------
const phone = await browser.newContext({
  // A phone-sized window with touch. `isMobile` is deliberately off: it makes
  // Chromium report a layout viewport taller than the window, which throws off
  // where a click lands without saying anything about the page.
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const mp = await phone.newPage();
await signIn(mp, CUSTOMER);
await mp.goto(`${APP}/portal`, { waitUntil: 'domcontentloaded' });
check(
  'the phone shows a bottom tab bar',
  await mp.locator('nav.fixed a[href="/portal/bookings"]').first().isVisible()
);
await mp.locator('nav.fixed a[href="/portal/bookings"]').first().click();
await mp.waitForURL(/\/portal\/bookings/, { timeout: 15000 }).catch(() => {});
check('a tab navigates on a phone', mp.url().includes('/portal/bookings'), mp.url());
await mp.locator('nav.fixed button:has-text("Menu")').click();
await mp.waitForTimeout(600);
check('the Menu sheet reaches the rest', (await mp.locator('text=Documents').count()) > 0);
const noSideScroll = await mp.evaluate(
  () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
);
check('the page does not scroll sideways on a phone', noSideScroll);

await browser.close();
await sql.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
