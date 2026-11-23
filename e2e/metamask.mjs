// Full role walkthrough signed through MetaMask (one tab per role), using a scripted EIP-1193 wallet
// that behaves like MetaMask: eth_requestAccounts, personal_sign, eth_sendTransaction, chain switching.
// Every pop-up a real user would confirm is counted, to prove the app went through the wallet.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../sdk/package.json', import.meta.url));
const { Wallet, JsonRpcProvider, FetchRequest, getBytes, keccak256, toUtf8Bytes } = require('ethers');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const ROOT = new URL('../', import.meta.url).pathname;
const OUT = new URL('./shots/metamask/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const demo = JSON.parse(readFileSync(ROOT + 'app/public/demo.json', 'utf8'));
const fr = new FetchRequest(process.env.RPC_URL ?? 'http://127.0.0.1:8545');
fr.timeout = 15000;
const rpc = new JsonRpcProvider(fr);
const retry = async (f) => {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 4 || !/timeout|TIMEOUT|network|NETWORK|ECONN|socket|fetch/i.test(String(e?.code ?? '') + String(e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
};
const chainHex = '0x' + Number(demo.network?.chainId ?? 31337).toString(16);
const keyOf = (id) =>
  id.startsWith('hospital-') ? keccak256(toUtf8Bytes('staff:' + demo.hospitals[Number(id.split('-')[1])].secret)) : demo.accounts[id].privateKey;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const errors = [];
const prompts = {};
let n = 0;
const ok = (m) => console.log('✓', m);
const shot = (p, name) => p.screenshot({ path: `${OUT}${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });

/** A tab with "MetaMask" holding one role wallet. */
async function mmTab(id) {
  const w = new Wallet(keyOf(id), rpc);
  prompts[id] = { sign: 0, tx: 0 };
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${id}: ${e}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${id}: ${m.text()}`));
  p.on('dialog', (d) => (errors.push(`${id} dialog: ${d.message()}`), d.dismiss()));
  await p.exposeFunction('__mm', async (method, params) => {
    switch (method) {
      case 'eth_chainId':
        return chainHex;
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return [w.address.toLowerCase()];
      case 'wallet_requestPermissions':
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null;
      case 'personal_sign': {
        if (params[1].toLowerCase() !== w.address.toLowerCase()) throw new Error('unknown account ' + params[1]);
        prompts[id].sign++;
        return w.signMessage(getBytes(params[0]));
      }
      case 'eth_sendTransaction': {
        const t = params[0];
        prompts[id].tx++;
        // sign once, then broadcast the same bytes (idempotent) — like a wallet retrying a flaky RPC
        const pop = await retry(() => w.populateTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, gasLimit: t.gas ? BigInt(t.gas) : undefined }));
        const signed = await w.signTransaction(pop);
        const res = await retry(() => rpc.broadcastTransaction(signed).catch((e) => (/already known|nonce too low/i.test(String(e?.message)) ? { hash: require('ethers').keccak256(signed) } : Promise.reject(e))));
        return res.hash;
      }
      default:
        return retry(() => rpc.send(method, params ?? []));
    }
  });
  await p.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__mm(method, params ?? []),
      on() {},
      removeListener() {},
    };
  });
  // sign in through the MetaMask panel on the sign-in page
  await p.goto(`${BASE}/#/login`);
  const panel = p.locator('section').filter({ hasText: 'Sign in with MetaMask' });
  await panel.getByRole('button', { name: /Connect MetaMask|Choose accounts/ }).click();
  await panel.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 75000 });
  await p.waitForTimeout(1500);
  return p;
}

process.on('uncaughtException', async (e) => {
  console.log('FAILED:', e.message.split('\n')[0]);
  console.log('browser errors:', errors.slice(-8));
  for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: `${OUT}fail-${i}.png` }).catch(() => {});
  process.exit(1);
});

// 1 · patient: identity
const asha = await mmTab('patient');
await asha.waitForTimeout(2500);
if (await asha.getByRole('button', { name: /Scan my Aadhaar QR/ }).count()) {
  await asha.getByRole('button', { name: /Scan my Aadhaar QR/ }).click();
  await asha.getByRole('button', { name: /Use UIDAI test card/ }).click();
  await asha.getByText(/Verified on-chain/).waitFor({ timeout: 60000 });
} else await asha.getByText(/verified · 18\+/).waitFor({ timeout: 60000 });
ok(`Asha signed in with MetaMask and verified Anon Aadhaar (MetaMask: ${prompts.patient.sign} signatures, ${prompts.patient.tx} tx)`);
await shot(asha, 'asha-verified');

// 2 · hospital staff (MetaMask sign-in only — hospitals never send transactions)
const hosp = await mmTab('hospital-1');
await hosp.getByTitle('Scan patient card').click();
await hosp.getByRole('button', { name: /Demo: Asha/ }).click();
await hosp.getByRole('button', { name: /Seal record & request consent/ }).click();
await hosp.getByText(/waiting for Asha/).waitFor({ timeout: 40000 });
ok(`hospital staff signed in with MetaMask, sealed the encounter (MetaMask: ${prompts['hospital-1'].tx} tx — as designed)`);

// 3 · patient signs consent (consent key derived from a MetaMask signature, record registered by MetaMask tx)
await asha.bringToFront();
const txBefore = prompts.patient.tx;
await asha.getByRole('button', { name: /Approve & sign/ }).click({ timeout: 75000 });
await asha.getByText(/No pending requests/).waitFor({ timeout: 60000 });
ok(`Asha approved: consent key derived via MetaMask, record registered in a MetaMask tx (+${prompts.patient.tx - txBefore} tx)`);

// 4 · hospital proves, relayer settles
await hosp.bringToFront();
await hosp.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Generate proof/.test(b.textContent) && !b.disabled), null, { timeout: 75000 });
await hosp.getByRole('button', { name: /Generate proof & submit/ }).click();
await Promise.race([
  hosp.getByText(/Settled ·/).waitFor({ timeout: 240000 }),
  hosp.locator('div.text-sm.text-rose').filter({ hasText: /\w/ }).first().waitFor({ timeout: 240000 }).then(async () => {
    throw new Error('hospital error: ' + (await hosp.locator('div.text-sm.text-rose').first().innerText()));
  }),
]);
ok('proof generated in-browser, settled via relayer');

// 5 · insurer
const ins = await mmTab('insurer');
await ins.getByText('₹73,800').first().waitFor({ timeout: 90000 });
await ins.getByRole('button', { name: /Upgrade Rahul/ }).click();
await ins.getByText(/Issued\. On-chain/).waitFor({ timeout: 90000 });
ok(`insurer (MetaMask) sees the blind claim and issued a policy (${prompts.insurer.tx} tx)`);
await shot(ins, 'insurer');

// 6 · share → doctor opens → revoke → blocked
await asha.bringToFront();
await asha.reload();
await asha.waitForTimeout(3000);
await asha.getByRole('button', { name: /^Share$/ }).first().click();
await asha.getByRole('button', { name: /Dr\. Meera Iyer/ }).first().click();
await asha.getByRole('button', { name: /Grant access/ }).click();
await asha.getByRole('button', { name: /Grant access/ }).waitFor({ state: 'detached', timeout: 30000 });
ok('Asha shared her record with the doctor (MetaMask tx)');
const doc = await mmTab('doctor');
await doc.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await doc.getByText(/Condition|Diagnosis/i).first().waitFor({ timeout: 75000 });
ok(`doctor (MetaMask) opened it: access logged by MetaMask tx, decrypted with a key derived from a MetaMask signature (${prompts.doctor.sign} sig, ${prompts.doctor.tx} tx)`);
await shot(doc, 'doctor');
await asha.bringToFront();
await asha.waitForTimeout(5000);
await asha.getByRole('button', { name: /Revoke \+ re-key/ }).first().click();
await asha.waitForTimeout(9000);
await doc.bringToFront();
await doc.reload();
await doc.waitForTimeout(3000);
await doc.getByRole('button', { name: /Open \(logged\)/ }).first().click();
await doc.getByText(/Blocked by HealthVault/).first().waitFor({ timeout: 60000 });
ok('after revoke + re-key the doctor is blocked (NoAccess)');

// 7 · break-glass: paramedic + two guardians, all MetaMask
const med = await mmTab('responder');
await med.getByRole('button', { name: /Scan emergency QR/ }).click();
await med.getByRole('button', { name: /Demo: Asha/ }).click();
await med.getByRole('button', { name: /Request break-glass access/ }).click();
await med.getByText(/Request #\d+/).first().waitFor({ timeout: 60000 });
for (const g of ['guardian1', 'guardian2']) {
  const gp = await mmTab(g);
  await gp.getByRole('button', { name: /Release my share/ }).click();
  await gp.getByText(/you released your share/).waitFor({ timeout: 75000 });
  await gp.close();
}
await med.bringToFront();
await med.waitForTimeout(3500);
await med.getByRole('button', { name: /Reconstruct key & open card/ }).click();
await med.getByText(/Penicillin|B\+/).first().waitFor({ timeout: 75000 });
ok(`paramedic + 2 guardians (all MetaMask) unlocked the emergency card`);
await shot(med, 'responder');

// 8 · regulator
const reg = await mmTab('regulator');
await reg.getByText(/matches/).first().waitFor({ timeout: 75000 });
ok('regulator signed in with MetaMask; root audit matches');

console.log('\nMetaMask prompts per role:', JSON.stringify(prompts));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
