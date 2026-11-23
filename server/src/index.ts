// Mohar API — three small jobs, none of which ever sees plaintext medical data:
//   1. IPFS pin node: stores ciphertext blobs by CIDv1 (sha2-256). Optional Pinata mirror (PINATA_JWT).
//   2. Consent inbox: hospital → patient claim-consent requests (carry ciphertext + wrapped key, never plaintext).
//   3. Relayer: submits proofs from its own wallet so the hospital's address never touches the chain.
//   (+) Ghost Pay Zcash rail: forwards settled payouts to shielded addresses when a zcashd/zallet RPC is configured.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hexlify, getBytes } from 'ethers';
import { cidOf } from '@kavach/sdk';
import { contracts, deployment, provider, signer } from '../../sdk/scripts/chain.js';
import { icdSearch, icdCount, hapiSample, checkFacility, checkClinician } from './clinical.js';
import { startGhostPay, ghostPayStatus, bridgeInfo, registerZcashInstruction, zcashAddress } from './ghostpay.js';

// testnet data lives apart from the throwaway local chain's (demo.sh wipes server/data on every run)
const DATA = process.env.DATA_DIR ? process.env.DATA_DIR.replace(/\/?$/, '/') : fileURLToPath(new URL('../data/', import.meta.url));
const IPFS = DATA + 'ipfs/';
mkdirSync(IPFS, { recursive: true });
const INBOX_FILE = DATA + 'inbox.json';

type Consent = {
  id: string;
  patient: string;
  createdAt: number;
  status: 'pending' | 'signed' | 'declined';
  request: any; // hospital-side summary + sealed record + wrapped key
  signature?: string;
  recordId?: string;
};
const inbox: Consent[] = existsSync(INBOX_FILE) ? JSON.parse(readFileSync(INBOX_FILE, 'utf8')) : [];
const saveInbox = () => writeFileSync(INBOX_FILE, JSON.stringify(inbox, null, 1));

const p = provider();
const relayer = contracts(signer('relayer', p));
const relayLog: any[] = [];

const app = new Hono();
app.use('*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------------- IPFS ----------------
app.put('/api/ipfs', async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length > 5_000_000) return c.json({ error: 'too large' }, 413);
  const cid = await cidOf(bytes);
  writeFileSync(IPFS + cid, bytes);
  if (process.env.PINATA_JWT) {
    // best-effort mirror to a public pinning service
    const fd = new FormData();
    fd.append('file', new Blob([bytes]), cid);
    fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: fd }).catch(() => {});
  }
  return c.json({ cid, size: bytes.length });
});

app.get('/api/ipfs/:cid', async (c) => {
  const cid = c.req.param('cid');
  if (!/^[a-z0-9]+$/.test(cid) || !existsSync(IPFS + cid)) return c.json({ error: 'not found' }, 404);
  const bytes = readFileSync(IPFS + cid);
  if ((await cidOf(new Uint8Array(bytes))) !== cid) return c.json({ error: 'content does not match CID' }, 500);
  return c.body(bytes, 200, { 'content-type': 'application/octet-stream', 'x-ipfs-cid': cid });
});

app.get('/api/ipfs', (c) => c.json(readdirSync(IPFS)));

// ---------------- consent inbox ----------------
app.post('/api/consent', async (c) => {
  const body = await c.req.json();
  const item: Consent = {
    id: crypto.randomUUID(),
    patient: String(body.patient).toLowerCase(),
    createdAt: Date.now(),
    status: 'pending',
    request: body.request,
  };
  inbox.push(item);
  saveInbox();
  return c.json(item);
});
app.get('/api/consent', (c) => {
  const patient = c.req.query('patient')?.toLowerCase();
  return c.json(inbox.filter((i) => !patient || i.patient === patient).sort((a, b) => b.createdAt - a.createdAt));
});
app.get('/api/consent/:id', (c) => {
  const i = inbox.find((x) => x.id === c.req.param('id'));
  return i ? c.json(i) : c.json({ error: 'not found' }, 404);
});
app.post('/api/consent/:id', async (c) => {
  const i = inbox.find((x) => x.id === c.req.param('id'));
  if (!i) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json();
  i.status = body.decline ? 'declined' : 'signed';
  i.signature = body.signature;
  i.recordId = body.recordId;
  saveInbox();
  return c.json(i);
});

// ---------------- relayer ----------------
function errName(e: any): string {
  return e?.revert?.name ?? e?.info?.error?.message ?? e?.shortMessage ?? String(e?.message ?? e);
}

app.post('/api/relay/simulate', async (c) => {
  const { proof, claim } = await c.req.json();
  try {
    await relayer.claims.submitClaim.staticCall(proof, claim);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, reason: errName(e) });
  }
});

app.post('/api/relay/claim', async (c) => {
  const { proof, claim, meta } = await c.req.json();
  try {
    await relayer.claims.submitClaim.staticCall(proof, claim); // never pay gas for a doomed tx
  } catch (e) {
    console.error('relay: claim rejected in simulation:', errName(e));
    return c.json({ ok: false, reason: errName(e) }, 400);
  }
  try {
    const t0 = Date.now();
    // public RPCs are load-balanced: a lagging node can hand out a stale nonce → reset and retry
    let tx: any;
    for (let i = 0; ; i++) {
      try {
        tx = await relayer.claims.submitClaim(proof, claim);
        break;
      } catch (e: any) {
        if (i >= 3 || !/nonce|replacement|already known/i.test(String(e?.shortMessage ?? e?.message))) throw e;
        console.error('relay: stale nonce, retrying:', e?.shortMessage ?? e?.message);
        (relayer.claims.runner as any).reset?.();
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    // once broadcast, keep polling for the receipt: one timed-out RPC call must not report a settled claim as failed
    let rc: any = null;
    for (let i = 0; i < 60 && !rc; i++) {
      rc = await p.getTransactionReceipt(tx.hash).catch(() => null);
      if (!rc) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!rc) throw new Error('not confirmed after 90 s: ' + tx.hash);
    if (rc.status === 0) throw new Error('reverted on-chain: ' + tx.hash);
    const out = { ok: true, txHash: tx.hash, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(), confirmMs: Date.now() - t0 };
    relayLog.push({ at: Date.now(), claim, proof, meta, ...out });
    return c.json(out);
  } catch (e) {
    console.error('relay: submit failed:', errName(e));
    return c.json({ ok: false, reason: errName(e) }, 500);
  }
});

app.get('/api/relay/log', (c) => c.json(relayLog.map(({ proof, ...r }) => ({ ...r, proofBytes: (proof.length - 2) / 2 }))));
app.get('/api/relay/last', (c) => c.json(relayLog.at(-1) ?? null));

// ---------------- CRS mirror: bb.js trusted-setup points served locally so proving works offline ----------------
const CRS_DIR = fileURLToPath(new URL('../../.cache/crs/', import.meta.url));
mkdirSync(CRS_DIR, { recursive: true });
app.get('/api/crs/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[a-z0-9_]+\.dat$/.test(file)) return c.json({ error: 'bad file' }, 400);
  const m = /bytes=0-(\d+)/.exec(c.req.header('range') ?? '');
  const end = m ? Number(m[1]) : -1;
  const path = CRS_DIR + file;
  let buf = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  if (buf.length === 0 || (end >= 0 && buf.length <= end)) {
    const headers: Record<string, string> = end >= 0 ? { Range: `bytes=0-${end}` } : {};
    let r = await fetch(`https://crs.aztec-cdn.foundation/${file}`, { headers }).catch(() => null);
    if (!r || !(r.ok || r.status === 206)) r = await fetch(`https://crs.aztec-labs.com/${file}`, { headers });
    buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(path, buf);
  }
  const body = end >= 0 ? buf.subarray(0, end + 1) : buf;
  return c.body(body, end >= 0 ? 206 : 200, { 'content-type': 'application/octet-stream', 'cross-origin-resource-policy': 'cross-origin' });
});

// ---------------- Anon Aadhaar (proof made on the patient's device at onboarding, cached) ----------------
app.get('/api/aadhaar/proof/:addr', (c) => {
  const addr = c.req.param('addr').toLowerCase();
  const f = fileURLToPath(new URL(`../../.cache/anon-aadhaar/proof-${addr}-11651504.json`, import.meta.url));
  if (existsSync(f)) return c.json(JSON.parse(readFileSync(f, 'utf8')));
  // Fresh clones: .cache is gitignored, but the same real proofs ship as contract-test fixtures.
  const dir = fileURLToPath(new URL('../../contracts/test/fixtures/', import.meta.url));
  for (const n of existsSync(dir) ? readdirSync(dir) : []) {
    if (!n.startsWith('aadhaar-')) continue;
    const j = JSON.parse(readFileSync(dir + n, 'utf8'));
    if (String(j.signal).toLowerCase() === addr) return c.json(j);
  }
  return c.json({ error: 'no proof for this wallet — run node sdk/scripts/aadhaar-prove.mjs <address>' }, 404);
});
// The UIDAI *test-mode* secure QR (signed with UIDAI's published test key) — rendered as a scannable card in the app.
app.get('/api/aadhaar/test-qr', (c) => {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL('../../sdk/assets/anon-aadhaar/dataInput.json', import.meta.url)), 'utf8'));
  return c.json({ qr: j.testQRData });
});

// LAN URLs so a phone on the same Wi-Fi can open a role by scanning a QR.
app.get('/api/lan', async (c) => {
  const { networkInterfaces } = await import('node:os');
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i: any) => i && i.family === 'IPv4' && !i.internal)
    .map((i: any) => i.address);
  return c.json({ ips, publicUrl: process.env.PUBLIC_APP_URL ?? null });
});

// ---------------- clinical data + registries ----------------
app.get('/api/icd10', (c) => c.json({ total: icdCount(), results: icdSearch(c.req.query('q') ?? '') }));
app.get('/api/fhir/hapi', async (c) => {
  try {
    return c.json(await hapiSample());
  } catch (e: any) {
    return c.json({ error: e.message }, 502);
  }
});
app.get('/api/registry/hfr/:id', async (c) => c.json(await checkFacility(c.req.param('id'), c.req.query('name') ?? '')));
app.get('/api/registry/nmc', async (c) => c.json(await checkClinician(c.req.query('reg') ?? '', c.req.query('name') ?? '')));

// ---------------- Ghost Pay ----------------
app.get('/api/ghostpay', async (c) => c.json({ ...ghostPayStatus(), ...(await bridgeInfo(relayer)), bridgeZcashAddress: await zcashAddress() }));
app.post('/api/ghostpay/zcash', async (c) => {
  const { nullifier, ua } = await c.req.json();
  try {
    registerZcashInstruction(nullifier, ua);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ ok: false, reason: e.message }, 400);
  }
});

// ---------------- event indexer ----------------
// Public RPCs cap eth_getLogs (Base Sepolia: 200 blocks per call). We walk the chain in small chunks, keep every
// event of our own contracts in memory, and answer the app's log queries from that — fast and range-free.
const dep = deployment();
const watched = Object.values(dep).filter((v): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v));
const logs: any[] = [];
let nextBlock = Number(dep.startBlock ?? 0);
let indexed = nextBlock - 1;
let indexing: Promise<void> | null = null;
const STEP = Number(process.env.LOG_CHUNK ?? 200);
function catchUp() {
  if (!indexing)
    indexing = (async () => {
      const head = await p.getBlockNumber();
      while (nextBlock <= head) {
        const to = Math.min(nextBlock + STEP - 1, head);
        const raw = await p.send('eth_getLogs', [{ address: watched, fromBlock: '0x' + nextBlock.toString(16), toBlock: '0x' + to.toString(16) }]);
        logs.push(...raw);
        indexed = to;
        nextBlock = to + 1;
      }
    })().finally(() => (indexing = null));
  return indexing;
}
(function loop() {
  catchUp()
    .catch((e) => console.error('indexer', e.message))
    .finally(() => setTimeout(loop, 1500));
})();
const lower = (x: any) => (typeof x === 'string' ? x.toLowerCase() : x);
const num = (b: any, dflt: number) => (b === undefined || b === null || b === 'latest' || b === 'pending' ? dflt : b === 'earliest' ? 0 : Number(b));
app.post('/api/logs', async (c) => {
  const f = await c.req.json();
  // freshen the index, but never let a stalled RPC call hang the app: answer from what we have after 1.5 s
  await Promise.race([catchUp().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  const addrs = f.address ? (Array.isArray(f.address) ? f.address : [f.address]).map(lower) : null;
  const from = num(f.fromBlock, 0);
  const to = num(f.toBlock, indexed);
  const topics: any[] = f.topics ?? [];
  const out = logs.filter((l) => {
    const bn = Number(l.blockNumber);
    if (bn < from || bn > to) return false;
    if (addrs && !addrs.includes(l.address.toLowerCase())) return false;
    return topics.every((t, i) => t === null || t === undefined || (Array.isArray(t) ? t.map(lower).includes(lower(l.topics[i])) : lower(t) === lower(l.topics[i])));
  });
  return c.json(out);
});

// A stalled public-RPC call (timeouts, dropped connections) must never take the relayer down.
process.on('unhandledRejection', (e: any) => console.error('unhandled (kept running):', e?.shortMessage ?? e?.message ?? e));
process.on('uncaughtException', (e: any) => console.error('uncaught (kept running):', e?.shortMessage ?? e?.message ?? e));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
startGhostPay(p, relayer).catch((e) => console.error('ghostpay', e));
console.log(`kavach api on :${port}`);
