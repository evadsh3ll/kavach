// Drives the real app end-to-end in Chromium: every page renders, then a full claim settles.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = new URL('./shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const AS = { login: '', vault: 'patient', seal: 'hospital-1', desk: 'insurer', provider: 'doctor', regulator: 'regulator', responder: 'responder', guardian: 'guardian1' };
for (const p of ['story', 'login', 'vault', 'seal', 'desk', 'provider', 'regulator', 'responder', 'guardian', 'attack', 'xray']) {
  await page.goto(`${BASE}/${AS[p] ? '?as=' + AS[p] : ''}#/${p}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}${p}.png`, fullPage: true });
  console.log('page', p, 'ok');
}

if (process.argv.includes('--flow')) {
  const t0 = Date.now();
  await page.goto(`${BASE}/?as=hospital-1#/seal`);
  await page.getByRole('button', { name: /Seal record & request consent/ }).click();
  await page.getByText(/waiting for/).waitFor({ timeout: 30000 });
  console.log('consent requested');
  const vault = await ctx.newPage();
  vault.on('pageerror', (e) => errors.push('vault: ' + e));
  await vault.goto(`${BASE}/?as=patient#/vault`);
  await vault.getByRole('button', { name: /Approve & sign/ }).click({ timeout: 30000 });
  await vault.getByText('No pending requests').waitFor({ timeout: 60000 });
  console.log('patient signed');
  await page.bringToFront();
  const btn = page.getByRole('button', { name: /Generate proof & submit/ });
  await btn.waitFor();
  await page.waitForFunction(() => !document.querySelector('button:disabled')?.textContent?.includes('Generate proof'), null, { timeout: 30000 });
  await btn.click();
  await page.getByText(/Settled ·/).waitFor({ timeout: 120000 });
  console.log('settled in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await page.screenshot({ path: `${OUT}seal-settled.png`, fullPage: true });
  await page.goto(`${BASE}/#/xray`);
  await page.getByRole('button', { name: /Scan the chain/ }).click();
  await page.getByText(/Scanned/).waitFor({ timeout: 60000 });
  console.log('leak scan:', await page.getByText(/0 leaks|leak found/).first().textContent());
  await page.screenshot({ path: `${OUT}xray.png`, fullPage: true });
}

if (process.argv.includes('--attacks')) {
  await page.goto(`${BASE}/#/attack`);
  await page.getByRole('button', { name: /Run all/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.chip').length > 0 && !document.querySelector('.animate-spin'), null, { timeout: 300000 });
  await page.waitForTimeout(500);
  const results = await page.$$eval('main section', (els) =>
    els.map((e) => `${e.querySelector('.font-semibold')?.textContent} → ${[...e.querySelectorAll('.chip')].map((c) => c.textContent).join(' | ')} :: ${e.querySelector('.mono')?.textContent ?? ''}`),
  );
  console.log(results.join('\n'));
  await page.screenshot({ path: `${OUT}attack.png`, fullPage: true });
}

console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
