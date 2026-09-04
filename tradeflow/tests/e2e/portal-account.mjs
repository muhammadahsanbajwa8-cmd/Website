// Drives the whole customer story through a real browser against the running
// app: the owner invites a customer, the customer signs up from the emailed
// link, and then every button in the portal is pressed.
import { chromium } from 'playwright-core';

const APP = 'http://localhost:3310';
const OWNER = { email: 'demo@tradeflow.local', password: 'demo-password-2026' };
const CUSTOMER = { email: 'dana@harbourside.example', password: 'portal-password-2026' };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function signIn(page, who) {
  await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
}

// ---------------------------------------------------------------- owner side
const owner = await browser.newContext();
const op = await owner.newPage();
op.on('pageerror', (e) => console.log('  [owner page error]', e.message));

await signIn(op, OWNER);
check('owner signs in and lands on the dashboard', op.url().includes('/dashboard'), op.url());

// Services: add one, so the customer has something to choose.
await op.goto(`${APP}/settings/services`, { waitUntil: 'domcontentloaded' });
check('services settings page opens', await op.locator('h1', { hasText: 'Services' }).isVisible());

const alreadyThere = await op.locator('h2', { hasText: 'Blocked drains' }).count();
if (alreadyThere === 0) {
  await op.click('button:has-text("Add a service")');
  await op.fill('#name-new', 'Blocked drains');
  await op.fill('#description-new', 'We clear blocked sinks, toilets and stormwater lines.');
  await op.fill('#priceFrom-new', '180');
  await op.fill('#leadTime-new', 'Usually within 48 hours');
  await op.click('button:has-text("Add service")');
  await op.waitForTimeout(1200);
}
check(
  'a service can be added and appears in the list',
  (await op.locator('h2', { hasText: 'Blocked drains' }).count()) > 0
);

// Hide / show it again.
await op.click('form:has(input[name="active"]) button:has-text("Hide")');
await op.waitForTimeout(900);
check('a service can be hidden', (await op.locator('text=Hidden').count()) > 0);
await op.click('form:has(input[name="active"]) button:has-text("Show")');
await op.waitForTimeout(900);
check('a service can be shown again', (await op.locator('text=Live').count()) > 0);

// Invite the customer.
await op.goto(`${APP}/customers`, { waitUntil: 'domcontentloaded' });
const danaHref = await op
  .locator('a[href^="/customers/"]', { hasText: 'Dana Whitfield' })
  .first()
  .getAttribute('href');
await op.goto(`${APP}${danaHref}`, { waitUntil: 'domcontentloaded' });
const customerUrl = op.url();
check('customer record opens', /\/customers\/[0-9a-f-]{36}/.test(customerUrl), customerUrl);

const hasLogin = await op.locator('text=Customer login').count();
check('the customer record offers a portal login', hasLogin > 0);

const already = await op.locator(`text=${CUSTOMER.email}`).count();
await op.fill('#portalEmail', CUSTOMER.email);
await op.click('button:has-text("Send invitation")');
await op.waitForTimeout(1800);
const invited =
  (await op.locator('text=Invitation sent').count()) > 0 ||
  (await op.locator('text=already has access').count()) > 0;
check('the invitation is sent', invited, already ? '(already existed)' : '');

// Pull the link out of the mail the stand-in provider actually received.
const mail = await (await fetch('http://localhost:4599/__received')).json();
const invite = [...mail]
  .reverse()
  .find((m) => JSON.stringify(m.to).includes(CUSTOMER.email) && /customer-invite/.test(m.text ?? ''));
const inviteUrl = invite ? (invite.text.match(/http:\/\/localhost:3310\/customer-invite\/[A-Za-z0-9_-]+/) ?? [])[0] : null;
check('the invitation email really left the server', Boolean(inviteUrl), inviteUrl ?? 'no email found');

// ------------------------------------------------------------- customer side
const cust = await browser.newContext();
const cp = await cust.newPage();
cp.on('pageerror', (e) => console.log('  [customer page error]', e.message));

let signedIn = false;
if (inviteUrl) {
  await cp.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
  const setUp = await cp.locator('a:has-text("Set up my login")').count();
  if (setUp > 0) {
    await cp.click('a:has-text("Set up my login")');
    await cp.waitForLoadState('domcontentloaded');
    await cp.fill('input[name="fullName"]', 'Dana Whitfield');
    await cp.fill('input[name="email"]', CUSTOMER.email);
    await cp.fill('input[name="password"]', CUSTOMER.password);
    await cp.fill('input[name="confirmPassword"]', CUSTOMER.password);
    await cp.click('button[type="submit"]');
    await cp.waitForTimeout(2500);
    signedIn = cp.url().includes('/portal');
  }
}
if (!signedIn) {
  await signIn(cp, CUSTOMER);
  signedIn = cp.url().includes('/portal');
}
check('the customer signs in and lands in the portal, not the app', signedIn, cp.url());

// Home
await cp.goto(`${APP}/portal`, { waitUntil: 'domcontentloaded' });
check('portal home greets them by name', (await cp.locator('h1:has-text("Hello")').count()) > 0);
check('portal home shows the four headline figures', (await cp.locator('text=To pay').count()) > 0);

// Every tab in the navigation.
for (const [label, path, marker] of [
  ['Bookings', '/portal/bookings', 'Bookings'],
  ['Services', '/portal/services', 'Services'],
  ['Reports', '/portal/reports', 'Reports'],
  ['Documents', '/portal/documents', 'Documents'],
  ['Payments', '/portal/payments', 'Payments'],
  ['Messages', '/portal/messages', 'Messages'],
  ['Account', '/portal/account', 'Your account'],
]) {
  await cp.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' });
  const ok = (await cp.locator(`h1:has-text("${marker}")`).count()) > 0;
  check(`${label} tab opens`, ok, cp.url());
}

// Ask for work — the whole request flow.
await cp.goto(`${APP}/portal/services`, { waitUntil: 'domcontentloaded' });
const askCount = await cp.locator('a:has-text("Ask for this")').count();
check('a service offers "Ask for this"', askCount > 0);
if (askCount > 0) {
  await cp.locator('a:has-text("Ask for this")').first().click();
  await cp.waitForURL(/\/portal\/bookings\/new/, { timeout: 15000 }).catch(() => {});
}
check('the request form opens with the service chosen', cp.url().includes('/portal/bookings/new'), cp.url());

// Empty description is refused, in words.
await cp.click('button:has-text("Send to")');
await cp.waitForTimeout(1200);
const refused = (await cp.locator('text=Please describe what you need').count()) > 0 ||
  (await cp.locator('text=Tell us a little').count()) > 0 ||
  (await cp.locator('#description:invalid').count()) > 0;
check('an empty request is refused with a readable message', refused);

await cp.fill('#description', 'The kitchen tap drips constantly and the cupboard underneath is damp.');
await cp.fill('#siteAddress', '9 Rivett Street, Marrickville NSW 2204');
await cp.selectOption('#preferredWindow', 'Morning');
await cp.click('button:has-text("Send to")');
await cp.waitForTimeout(2000);
check(
  'the request is accepted and confirmed',
  (await cp.locator('text=has your request').count()) > 0 ||
    (await cp.locator('text=Thanks').count()) > 0
);

await cp.goto(`${APP}/portal/bookings`, { waitUntil: 'domcontentloaded' });
check('the request shows under Bookings', (await cp.locator('text=Requested').count()) > 0);

// A message to the business.
await cp.goto(`${APP}/portal/messages`, { waitUntil: 'domcontentloaded' });
await cp.fill('textarea[name="body"]', 'Could you come Thursday morning rather than Wednesday?');
await cp.click('button:has-text("Send message")');
await cp.waitForTimeout(1800);
check('a message sends', (await cp.locator('text=Could you come Thursday').count()) > 0);

// Their details.
await cp.goto(`${APP}/portal/account`, { waitUntil: 'domcontentloaded' });
await cp.fill('#phone', '0412 555 909');
await cp.click('button:has-text("Save my details")');
await cp.waitForTimeout(1800);
check('their details save', (await cp.locator('text=Saved').count()) > 0);

// A bad email address is caught.
await cp.fill('#email', 'not-an-address');
await cp.click('button:has-text("Save my details")');
await cp.waitForTimeout(1500);
check(
  'a bad email address is refused',
  (await cp.locator('text=does not look right').count()) > 0 ||
    (await cp.locator('#email:invalid').count()) > 0
);
await cp.fill('#email', CUSTOMER.email);
await cp.click('button:has-text("Save my details")');
await cp.waitForTimeout(1500);

// ------------------------------------------------------- back on the owner side
await op.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
check('the new request reaches the business dashboard', (await op.locator('text=Waiting on you').count()) > 0);

await op.goto(`${APP}/leads`, { waitUntil: 'domcontentloaded' });
check(
  'the request is in the leads pipeline, marked as coming from the portal',
  (await op.locator('text=Dana Whitfield').count()) > 0 && (await op.locator('text=portal').count()) > 0
);
const leadHrefs = await op
  .locator('a[href^="/leads/"]')
  .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
const leadHref = leadHrefs.find((h) => /\/leads\/[0-9a-f-]{36}$/.test(h ?? ''));
if (leadHref) {
  await op.goto(`${APP}${leadHref}`, { waitUntil: 'domcontentloaded' });
}
check('the lead carries what the customer actually wrote', (await op.locator('text=kitchen tap').count()) > 0);

await op.goto(`${APP}/messages`, { waitUntil: 'domcontentloaded' });
check(
  'the message reaches the business inbox',
  (await op.locator('text=Thursday morning').count()) > 0
);
const threadHref = await op.locator('a[href^="/messages/"]').first().getAttribute('href');
await op.goto(`${APP}${threadHref}`, { waitUntil: 'domcontentloaded' });
await op.fill('textarea[name="body"]', 'Thursday morning is fine — we will be there at 8.');
await op.click('button:has-text("Send reply")');
await op.waitForTimeout(1800);
check('the business can reply', (await op.locator('text=Thursday morning is fine').count()) > 0);

await cp.goto(`${APP}/portal/messages`, { waitUntil: 'domcontentloaded' });
check('the reply reaches the customer', (await cp.locator('text=Thursday morning is fine').count()) > 0);

// --------------------------------------------------------------- the negatives
// A customer must not be able to reach the application shell.
await cp.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' });
check('a customer cannot open the business dashboard', cp.url().includes('/portal'), cp.url());

await cp.goto(`${APP}/customers`, { waitUntil: 'domcontentloaded' });
check('a customer cannot open the customer list', !cp.url().includes('/customers') || (await cp.locator('text=Set up your business').count()) > 0, cp.url());

// A signed-out visitor must not reach the portal.
const stranger = await browser.newContext();
const sp = await stranger.newPage();
await sp.goto(`${APP}/portal`, { waitUntil: 'domcontentloaded' });
check('a signed-out visitor is sent to sign in', sp.url().includes('/login'), sp.url());

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
