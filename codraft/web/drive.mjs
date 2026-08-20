import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1000, height: 1200 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('file://' + process.argv[2]);

const click = async (t) => { await p.getByRole('button', { name: t, exact: true }).click(); await p.waitForTimeout(400); };

await click('Western Australia');
await click('R20');
await p.fill('#cd-lw', '15');
await p.fill('#cd-ld', '30');
await click('Use this block');
await click('Two storeys');
await click('4');            // bedrooms
await p.getByRole('button', { name: '2', exact: true }).click(); await p.waitForTimeout(400); // bathrooms
await click('Double');
await click('Theatre'); await click('Alfresco'); await click('Pool');
await click('Done');
await p.waitForTimeout(1500);

const svgs = await p.locator('.cd-sheet svg').count();
const checks = await p.locator('.cd-checks li').allTextContents();
const rooms = await p.locator('.cd-rooms li').count();
const stats = await p.locator('.cd-stats').innerText().catch(()=> 'NO STATS');
console.log('svg sheets:', svgs, '| rooms:', rooms);
console.log('stats:', stats.replace(/\n/g,' | '));
console.log('checks:');
checks.forEach(c => console.log('  -', c));
console.log('errors:', errs.length ? errs : 'none');
await p.screenshot({ path: process.argv[3], fullPage: true });
await b.close();
