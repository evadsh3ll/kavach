// Live-demo walkthrough with role sign-in: one tab per role, exactly as a presenter would do it.
// Patient → Hospital → Insurer claim, sharing with doctor/lab/pharmacy, revoke, break-glass, duplicate Aadhaar.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = new URL('./shots/roles/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const errors = [];
let n = 0;
const shot = (p, name) => p.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
async function tab(as, page) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${as}: ${e}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${as}: ${m.text()}`));
  p.on('dialog', (d) => (errors.push(`${as} dialog: ${d.message()}`), d.dismiss()));
  await p.goto(`${BASE}/?as=${as}#/${page}`);
  await p.waitForTimeout(1500);
  return p;
}
const ok = (m) => console.log('✓', m);

// 0. sign-in screen
const login = await ctx.newPage();
login.on('pageerror', (e) => errors.push(`login: ${e}`));
await login.goto(`${BASE}/#/login`);
await login.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
await shot(login, 'login');
await login.getByRole('button', { name: /Sign in/ }).first().click();
await login.waitForURL(/#\/vault/);
ok('sign-in from the role picker lands on the patient vault');
await login.close();

// 1. patient verifies Anon Aadhaar
const asha = await tab('patient', 'vault');
await asha.getByRole('button', { name: /Scan my Aadhaar QR/ }).click();
await asha.getByRole('button', { name: /Use UIDAI test card/ }).click();
await asha.getByText(/Verified on-chain/).waitFor({ timeout: 30000 });
await shot(asha, 'asha-aadhaar');
ok('Asha verified with Anon Aadhaar on-chain');

// 2. hospital scans card, seals, asks consent
const hosp = await tab('hospital-1', 'seal');
await hosp.getByTitle('Scan patient card').click();
await hosp.getByRole('button', { name: /Demo: Asha/ }).click();
await hosp.getByText(/Card scanned: Asha/).waitFor();
await hosp.getByRole('button', { name: /Seal record & request consent/ }).click();
await hosp.getByText(/waiting for Asha/).waitFor({ timeout: 30000 });
await shot(hosp, 'hospital-sealed');
ok('hospital scanned Asha’s card and sent a sealed consent request');

// 3. patient signs
await asha.bringToFront();
await asha.getByRole('button', { name: /Approve & sign/ }).click({ timeout: 20000 });
await asha.getByText(/No pending requests/).waitFor({ timeout: 60000 });
ok('Asha re-derived the terms and signed');

// 4. hospital proves + settles
await hosp.bringToFront();
const gen = hosp.getByRole('button', { name: /Generate proof & submit/ });
await hosp.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Generate proof/.test(b.textContent) && !b.disabled), null, { timeout: 30000 });
await gen.click();
await hosp.getByText(/Settled ·/).waitFor({ timeout: 180000 });
await shot(hosp, 'hospital-settled');
ok('proof generated in-browser and settled via relayer');

// 5. insurer
const ins = await tab('insurer', 'desk');
await ins.getByText('₹73,800').first().waitFor({ timeout: 15000 });
await shot(ins, 'insurer');
ok('insurer sees ₹73,800 + proof, diagnosis redacted');

// 6. sharing
await asha.bringToFront();
await asha.reload();
await asha.waitForTimeout(2500);
const shareBtns = asha.getByRole('button', { name: /^Share$/ });
async function shareWith(label) {
  await shareBtns.first().click();
  await asha.getByRole('button', { name: new RegExp(label) }).first().click();
  await asha.getByRole('button', { name: /Grant access/ }).click();
  await asha.getByRole('button', { name: /Grant access/ }).waitFor({ state: 'detached', timeout: 30000 });
  await asha.waitForTimeout(1200);
}
await shareWith('Dr. Meera Iyer');
ok('shared full record with doctor');
await shareWith('Jan Aushadhi Pharmacy');
ok('shared prescription slice with pharmacy');
await shareWith('Raipur Diagnostics Lab');
ok('shared lab slice with lab');
await asha.waitForTimeout(5500);
await shot(asha, 'asha-shared');

const doc = await tab('doctor', 'provider');
await doc.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await doc.getByText(/Condition|Diagnosis/i).first().waitFor({ timeout: 30000 });
await shot(doc, 'doctor-open');
ok('doctor opened the record (access logged on-chain first)');

const ph = await tab('pharmacy', 'provider');
await ph.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await ph.waitForTimeout(4000);
const phText = await ph.locator('main').innerText();
await shot(ph, 'pharmacy-open');
console.log(phText.includes('C50') ? '✗ pharmacy can see the diagnosis!' : '✓ pharmacy sees prescriptions only — no diagnosis');

// 7. revoke doctor → blocked
await asha.bringToFront();
await asha.getByRole('button', { name: /Revoke \+ re-key/ }).first().click();
await asha.waitForTimeout(9000);
await doc.bringToFront();
await doc.reload();
await doc.waitForTimeout(2500);
await doc.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await doc.getByText(/Blocked by HealthVault/).first().waitFor({ timeout: 20000 });
ok('after revoke + re-key the doctor is blocked: ' + (await doc.getByText(/Blocked by HealthVault/).first().innerText()));

// 8. break-glass
const med = await tab('responder', 'responder');
await med.getByRole('button', { name: /Scan emergency QR/ }).click();
await med.getByRole('button', { name: /Demo: Asha/ }).click();
await med.getByRole('button', { name: /Request break-glass access/ }).click();
await med.getByText(/Request #0/).waitFor({ timeout: 20000 });
for (const g of ['guardian1', 'guardian2']) {
  const gp = await tab(g, 'guardian');
  await gp.getByRole('button', { name: /Release my share/ }).click();
  await gp.getByText(/you released your share/).waitFor({ timeout: 20000 });
  if (g === 'guardian2') await shot(gp, 'guardian');
  await gp.close();
}
await med.bringToFront();
await med.waitForTimeout(3500);
await med.getByRole('button', { name: /Reconstruct key & open card/ }).click();
await med.getByText(/Penicillin|B\+/).first().waitFor({ timeout: 20000 });
await shot(med, 'responder-card');
ok('2 of 3 guardians → paramedic opened the emergency card');

// 9. Rahul tries Asha's Aadhaar
const rahul = await tab('patient2', 'vault');
await rahul.getByRole('button', { name: /Try Asha’s Aadhaar/ }).click();
await rahul.getByRole('button', { name: /Present Asha’s card/ }).click();
await rahul.getByText(/DuplicateAadhaar/).waitFor({ timeout: 20000 });
await shot(rahul, 'rahul-duplicate');
ok('Rahul blocked: DuplicateAadhaar');

// 10. wrong role guard + guide
await rahul.goto(`${BASE}/#/desk`);
await rahul.getByText(/This screen belongs to the Insurer/).waitFor();
ok('role guard: patient cannot open the insurer desk');
await asha.bringToFront();
await asha.reload();
await asha.waitForTimeout(4000);
await shot(asha, 'asha-final');
const ticks = await asha.locator('aside li .bg-mint\\/15').count();
console.log(`✓ demo guide: ${ticks}/11 steps ticked from chain state`);

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
