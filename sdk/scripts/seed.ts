// Seeds a fresh deployment with a realistic demo world and writes app/public/demo.json.
//   regulator approves 4 hospitals (+1 pending "Shady Clinic"), publishes the Merkle root
//   insurer is approved, funds a ₹1 crore pool, issues 2 policy commitments
//   patient Asha has an encrypted FHIR history on IPFS + break-glass guardians + emergency card
import { mkdirSync, writeFileSync } from 'node:fs';
import { Wallet, keccak256, toUtf8Bytes, hexlify, getBytes } from 'ethers';
import {
  HOSPITALS,
  HOSP_DEPTH,
  MerkleTree,
  hospitalLeaf,
  newPolicy,
  policyCommitment,
  policyToJSON,
  randomField,
  toHex32,
  encounterBundle,
  emergencyCard,
  newRecordKey,
  sealJSON,
  sealedBytes,
  cidOf,
  wrapKey,
  splitSecret,
  consentKeyFor,
  encryptionKeyFor,
  FIELD_MODULUS,
  lookupFacilitySnapshot,
  verifyFacility,
  lookupClinicianSnapshot,
  verifyClinician,
} from '../src/index.js';
import { existsSync, readFileSync } from 'node:fs';
import { KEYS as ANVIL_KEYS, ROLES, ROOT, contracts, deployment, provider, signer } from './chain.js';

const DAY = 86400;
const p = provider();
const d = deployment();
const now = (await p.getBlock('latest'))!.timestamp;
const ipfsDir = `${process.env.DATA_DIR ? process.env.DATA_DIR.replace(/\/?$/, '/') : ROOT + 'server/data/'}ipfs/`;
mkdirSync(ipfsDir, { recursive: true });

async function putIpfs(bytes: Uint8Array) {
  const cid = await cidOf(bytes);
  writeFileSync(ipfsDir + cid, bytes);
  return cid;
}

const reg = contracts(signer('regulator', p));
const ins = contracts(signer('insurer', p));
const relay = contracts(signer('relayer', p));
const wallet = (r: keyof typeof ROLES) => new Wallet(ANVIL_KEYS[ROLES[r]]);

console.log('· hospitals');
const hospitals = [] as any[];
// Stable per wallets file (derived from the regulator's key), so hospital staff keys imported into MetaMask
// survive a chain restart. Still unguessable without that key.
const hospitalSecret = (hfrId: string) => BigInt(keccak256(toUtf8Bytes(`mohar:hospital-secret:${ANVIL_KEYS[0]}:${hfrId}`))) % FIELD_MODULUS;
for (const h of HOSPITALS) {
  const secret = hospitalSecret(h.hfrId);
  const leaf = await hospitalLeaf(secret);
  await (await relay.regulator.requestListing(h.name, h.hfrId, toHex32(leaf))).wait();
  hospitals.push({ ...h, secret: toHex32(secret), leaf: toHex32(leaf) });
}
const shadySecret = randomField();
await (await relay.regulator.requestListing('Shady Clinic (unlicensed)', 'IN0000000000', toHex32(await hospitalLeaf(shadySecret)))).wait();
for (let i = 0; i < hospitals.length; i++) {
  const v = verifyFacility(lookupFacilitySnapshot(hospitals[i].hfrId), hospitals[i].name, 'hfr-offline-snapshot');
  if (!v.ok) throw new Error('HFR check failed for ' + hospitals[i].name);
  await (await reg.regulator.attestHospital(i, v.attestation, v.source)).wait();
  await (await reg.regulator.approveHospital(i)).wait();
}
// a new applicant left pending + unattested for the live demo of the HFR check
await (await relay.regulator.requestListing('Lakeview Nursing Home', 'IN2210000505', toHex32(await hospitalLeaf(randomField())))).wait();
const tree = await MerkleTree.build(HOSP_DEPTH, hospitals.map((h) => BigInt(h.leaf)));
await (await reg.regulator.publishRoot(toHex32(tree.root), false)).wait();

console.log('· insurer + pool');
const insurer = wallet('insurer');
await (await reg.regulator.approveInsurer(insurer.address, 'Suraksha Health Insurance', 'IRDAI/HLT/2026/147')).wait();
await (await reg.token.mint(insurer.address, 10_000_000_00n)).wait(); // ₹1 crore
await (await ins.token.approve(d.claimSettlement, 2n ** 255n)).wait();
await (await ins.claims.fundPool(10_000_000_00n)).wait();

console.log('· policies');
const asha = wallet('patient');
const rahul = wallet('patient2');
const ashaPid = randomField();
const rahulPid = randomField();
const policies = {
  asha: newPolicy({
    policyId: ashaPid,
    planName: 'Arogya Shield Gold',
    insurerName: 'Suraksha Health Insurance',
    patientName: 'Asha Verma',
    patientPubKey: consentKeyFor(asha.privateKey, ashaPid).publicKey, // per-policy consent key, never on-chain
    startDate: now - 400 * DAY,
    endDate: now + 330 * DAY,
    waitingUntil: now - 370 * DAY,
    sumInsured: 5_00_000_00, // ₹5 lakh
    deductible: 5_000_00,
    copayBps: 1000,
    coveredProcedures: ['SG039', 'MO012', 'SO051', 'MC011', 'OR004', 'MG053'],
    exclusions: ['Z41.1', 'N97.9'],
  }),
  rahul: newPolicy({
    policyId: rahulPid,
    planName: 'Arogya Basic',
    insurerName: 'Suraksha Health Insurance',
    patientName: 'Rahul Sahu',
    patientPubKey: consentKeyFor(rahul.privateKey, rahulPid).publicKey,
    startDate: now - 20 * DAY,
    endDate: now + 345 * DAY,
    waitingUntil: now + 10 * DAY, // still in 30-day initial waiting period
    sumInsured: 2_00_000_00,
    deductible: 10_000_00,
    copayBps: 2000,
    coveredProcedures: ['SG039', 'MC011', 'OR004'],
    exclusions: ['Z41.1'],
  }),
};
const commitments: Record<string, string> = {};
for (const [k, pol] of Object.entries(policies)) {
  commitments[k] = toHex32(await policyCommitment(pol));
  await (await ins.claims.issuePolicy(commitments[k])).wait();
}

console.log('· clinicians (NMC)');
{
  const v = verifyClinician(lookupClinicianSnapshot('CGMC/2011/4471'), 'Dr. Meera Iyer', 'nmc-offline-snapshot');
  await (await reg.regulator.registerClinician(wallet('doctor').address, 'Dr. Meera Iyer', 'CGMC/2011/4471', v.attestation)).wait();
}

// Anon Aadhaar onboarding happens live in the app (Story step 1) — see PatientRegistry.

console.log('· encryption keys');
for (const r of ['patient', 'patient2', 'doctor', 'guardian1', 'guardian2', 'guardian3', 'responder', 'lab', 'pharmacy'] as const) {
  const c = contracts(signer(r, p));
  await (await c.vault.registerKey(encryptionKeyFor(wallet(r).privateKey).publicKey)).wait(); // signature-derived, so MetaMask can reproduce it
}

console.log('· Asha: past record + emergency card + guardians');
const ashaVault = contracts(signer('patient', p));
const past = encounterBundle({
  patientName: 'Asha Verma',
  patientId: 'asha',
  hospitalName: 'Ramkrishna Care Hospital',
  hfrId: 'IN2210000303',
  diagnosis: { code: 'E11.9', display: 'Type 2 diabetes mellitus' },
  procedure: { code: 'OPD', display: 'Outpatient consultation' },
  medications: ['Metformin 500mg BD'],
  allergies: ['Penicillin'],
  bloodGroup: 'B+',
  observations: [{ code: '4548-4', display: 'HbA1c', value: 7.1, unit: '%' }],
  date: new Date((now - 120 * DAY) * 1000).toISOString().slice(0, 10),
  billItems: [{ label: 'Consultation', amount: 80000 }],
});
const records: any[] = [];
async function addRecord(kind: string, doc: unknown) {
  const key = await newRecordKey();
  const sealed = await sealJSON(key, doc);
  const bytes = sealedBytes(sealed);
  const cid = await putIpfs(bytes);
  const recordId = keccak256(toUtf8Bytes(`${asha.address}:${kind}:${cid}`));
  await (await ashaVault.vault.registerRecord(recordId, keccak256(bytes), cid, kind)).wait();
  records.push({ recordId, cid, kind, key: hexlify(key) });
  return { recordId, key, cid };
}
await addRecord('encounter', past);
const card = emergencyCard({
  patientName: 'Asha Verma',
  bloodGroup: 'B+',
  allergies: ['Penicillin'],
  medications: ['Metformin 500mg BD'],
  conditions: ['Type 2 diabetes'],
  emergencyContact: 'Ravi Verma · +91 98xxxxxx21',
});
const em = await addRecord('emergency-card', card);
const shares = splitSecret(em.key, 3, 2);
const guardians = (['guardian1', 'guardian2', 'guardian3'] as const).map(wallet);
const wrapped = await Promise.all(
  shares.map(async (s, i) => toUtf8Bytes(JSON.stringify({ x: s.x, w: await wrapKey(getBytes(s.y), encryptionKeyFor(guardians[i].privateKey).publicKey) }))),
);
await (await ashaVault.breakGlass.setGuardians(guardians.map((g) => g.address), em.recordId, wrapped)).wait();

const accounts = Object.fromEntries(
  Object.entries(ROLES).map(([r, i]) => [r, { address: new Wallet(ANVIL_KEYS[i]).address, privateKey: ANVIL_KEYS[i] }]),
);

// Hospitals never send transactions; their staff sign in with a key derived from the hospital secret.
const staffKey = (secret: string) => keccak256(toUtf8Bytes('staff:' + secret));
for (const h of hospitals) h.staff = new Wallet(staffKey(h.secret)).address;
const net = await p.getNetwork();
const chainId = Number(net.chainId);
const network =
  chainId === 84532
    ? { chainId, name: 'Base Sepolia', publicRpc: 'https://base-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.basescan.org', currency: 'ETH' }
    : { chainId, name: 'Mohar local chain', publicRpc: process.env.PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545', explorer: null, currency: 'ETH' };

const demo = {
  network,
  _warning: 'DEMO ONLY — local Anvil keys and secrets. In production each party holds its own keys.',
  rpc: process.env.PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545',
  deployment: d,
  accounts,
  names: {
    regulator: 'National Health Regulator',
    insurer: 'Suraksha Health Insurance',
    patient: 'Asha Verma',
    patient2: 'Rahul Sahu',
    doctor: 'Dr. Meera Iyer (AIIMS Raipur)',
    relayer: 'Kavach Relayer',
    guardian1: 'Ravi Verma (husband)',
    guardian2: 'Dr. Kavita Rao (family doctor)',
    guardian3: 'Neha Verma (sister)',
    responder: 'CG 108 Ambulance Paramedic',
    lab: 'Raipur Diagnostics Lab',
    pharmacy: 'Jan Aushadhi Pharmacy',
  },
  hospitals,
  shadyClinic: { name: 'Shady Clinic (unlicensed)', secret: toHex32(shadySecret) },
  policies: Object.fromEntries(Object.entries(policies).map(([k, v]) => [k, { json: policyToJSON(v), commitment: commitments[k] }])),
  records: { asha: records },
  seededAt: now,
};
mkdirSync(`${ROOT}app/public`, { recursive: true });
writeFileSync(`${ROOT}app/public/demo.json`, JSON.stringify(demo, null, 2));
if (chainId !== 31337) writeFileSync(`${ROOT}.demo-${chainId}.json`, JSON.stringify(demo, null, 2), { mode: 0o600 }); // kept safe from demo.sh
// A private cheat-sheet for importing the role wallets into MetaMask (gitignored).
{
  const rows = Object.entries(ROLES)
    .filter(([r]) => r !== 'relayer')
    .map(([r, i]) => `| ${(demo.names as any)[r]} | ${r} | \`${new Wallet(ANVIL_KEYS[i]).address}\` | \`${ANVIL_KEYS[i]}\` |`);
  const staff = hospitals.map((h: any) => `| ${h.name} (staff) | hospital | \`${h.staff}\` | \`${staffKey(h.secret)}\` |`);
  const md = [
    '# Mohar role wallets — PRIVATE, test networks only',
    '',
    `Network: **${network.name}** · chain ID \`${network.chainId}\` · RPC \`${network.publicRpc}\``,
    '',
    'MetaMask → Add network manually with the values above, then Import account → paste a private key.',
    'Connect all the accounts you imported to the site; each browser tab can sign as a different one.',
    'Hospital staff keys hold no ETH: hospitals only sign in, they never send transactions (a relayer does).',
    '',
    '| Who | Role | Address | Private key |',
    '|---|---|---|---|',
    ...rows,
    ...staff,
    '',
  ].join('\n');
  writeFileSync(`${ROOT}ROLE-WALLETS.${chainId === 84532 ? 'base-sepolia' : 'local'}.md`, md, { mode: 0o600 });
}
console.log('✓ seeded. root', toHex32(tree.root));
process.exit(0);
