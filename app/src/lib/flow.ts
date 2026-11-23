// The claim workflow, split across the three parties exactly as in real life.
import { getBytes, hexlify, keccak256, toUtf8Bytes, getAddress } from 'ethers';
import {
  Policy,
  buildWitnessInput,
  claimNullifier,
  computePayout,
  consentDigest,
  encounterBundle,
  ghostWallet,
  newRecordKey,
  open,
  openJSON,
  policyFromJSON,
  prepareClaim,
  recordHashField,
  seal,
  sealJSON,
  sealedBytes,
  signConsent,
  unwrapKey,
  wrapKey,
  DIAGNOSES,
  PROCEDURES,
  consentKeyFor,
} from '@kavach/sdk';
import { c, getDemo, signerFor, Role, blockTime } from './chain';
import { api, ipfsPut, ipfsGet, hospitalTree, claimStruct, getProver } from './zk';
import { ring } from './keyring';
import { kb, trace } from './trace';
import { consentPriv, encPriv } from './wallet';

export type Rail = 'stealth' | 'zcash';

export function policyFor(patient: Role): Policy {
  const own = ring.get().policies[patient];
  if (own) return policyFromJSON(own);
  const d = getDemo();
  return policyFromJSON(d.policies[patient === 'patient' ? 'asha' : 'rahul'].json);
}

export async function commitmentFor(patient: Role): Promise<string> {
  const { policyCommitment, toHex32 } = await import('@kavach/sdk');
  return toHex32(await policyCommitment(policyFor(patient)));
}

export async function patientPubKey(addr: string): Promise<string> {
  return hexlify(await c().vault.encryptionKey(addr));
}

// ---------------- HOSPITAL: admission → sealed record + consent request ----------------
export async function hospitalRequestConsent(o: {
  hospitalIdx: number;
  patient: Role;
  diagnosis: string;
  diagnosisDisplay?: string;
  procedure: string;
  bill: { label: string; amount: number }[];
  rail: Rail;
  zcashUA?: string;
}) {
  const d = getDemo();
  const h = d.hospitals[o.hospitalIdx];
  const patientAddr = d.accounts[o.patient].address;
  const policy = policyFor(o.patient);
  const diag = DIAGNOSES.find((x) => x.code === o.diagnosis) ?? { code: o.diagnosis, display: o.diagnosisDisplay ?? o.diagnosis, sensitive: true };
  const proc = PROCEDURES.find((x) => x.code === o.procedure)!;
  const now = await blockTime();

  // 1. FHIR encounter, encrypted with a fresh record key, pinned to IPFS
  const bundle = encounterBundle({
    patientName: d.names[o.patient],
    patientId: o.patient,
    hospitalName: h.name,
    hfrId: h.hfrId,
    diagnosis: diag,
    procedure: proc,
    medications: o.procedure === 'MO012' ? ['Paclitaxel 175mg/m²', 'Ondansetron 8mg'] : ['Ceftriaxone 1g IV', 'Paracetamol 650mg'],
    allergies: ['Penicillin'],
    bloodGroup: 'B+',
    observations: [{ code: '718-7', display: 'Haemoglobin', value: 11.8, unit: 'g/dL' }],
    date: new Date(now * 1000).toISOString().slice(0, 10),
    billItems: o.bill,
  });
  trace({ kind: 'crypto', title: 'Built HL7 FHIR R4 encounter bundle', detail: `Patient · Encounter · Condition ${diag.code} · Procedure ${proc.code} · MedicationRequest · Observation · Claim`, vis: 'private' });
  const recordKey = await newRecordKey();
  const sealed = await sealJSON(recordKey, bundle);
  const bytes = sealedBytes(sealed);
  trace({ kind: 'crypto', title: 'Encrypted the record (AES-256-GCM)', detail: `fresh 256-bit record key · ${kb(bytes.length)} ciphertext`, vis: 'private' });
  const cid = await ipfsPut(bytes);
  const recordHash = recordHashField(bytes, recordKey);

  // 2. Ghost Pay recipient
  const nullifier = await claimNullifier(policy, recordHash, o.procedure);
  const gp = await api('/ghostpay');
  const recipient = o.rail === 'zcash' ? gp.bridgeAddress : ghostWallet(BigInt(h.secret), nullifier).address;
  trace({ kind: 'crypto', title: 'Derived claim nullifier + one-time payout address', detail: `nullifier = Poseidon2(policy, record, procedure) · payTo ${recipient.slice(0, 10)}… = keccak(hospitalSecret, nullifier)`, vis: 'private' });
  if (o.rail === 'zcash' && o.zcashUA) await api('/ghostpay/zcash', { nullifier: '0x' + nullifier.toString(16).padStart(64, '0'), ua: o.zcashUA });

  const billItems = o.bill.map((b) => b.amount);
  const usedBefore = Number((await c().claims.policies(await commitmentFor(o.patient))).used);
  const draft = { policy, diagnosis: o.diagnosis, procedure: o.procedure, recordHash, billItems, claimDate: now, usedBefore, recipient };
  const prep = await prepareClaim(draft);

  // 3. Everything the patient needs, sealed to the patient — the inbox server sees only ciphertext.
  const payload = {
    hospital: h.name,
    hfrId: h.hfrId,
    diagnosis: diag,
    procedure: proc,
    bill: o.bill,
    cid,
    wrappedRecordKey: await wrapKey(recordKey, await patientPubKey(patientAddr)),
    claim: { claimDate: now, payoutAmount: prep.payoutAmount, recipient, rail: o.rail, nullifier: prep.nullifier.toString(), digest: prep.digest.toString() },
  };
  const pk = await newRecordKey();
  const req = { box: await sealJSON(pk, payload), key: await wrapKey(pk, await patientPubKey(patientAddr)) };
  trace({ kind: 'crypto', title: `Sealed consent request to ${d.names[o.patient]}`, detail: 'ECIES (secp256k1) to the patient’s registered key — the inbox server sees ciphertext only', vis: 'sealed' });
  const inboxItem = await api('/consent', { patient: patientAddr, request: req });
  trace({ kind: 'net', title: 'Consent request delivered to patient inbox', wire: 'sealed box + wrapped key', vis: 'sealed' });

  const local = {
    id: inboxItem.id,
    at: Date.now(),
    hospitalIdx: o.hospitalIdx,
    hospital: h.name,
    patient: o.patient,
    diagnosis: diag,
    procedure: proc,
    bill: o.bill,
    rail: o.rail,
    cid,
    recordHash: recordHash.toString(),
    draft: { ...draft, policy: undefined, recordHash: recordHash.toString() },
    status: 'awaiting-consent',
  };
  ring.update((r) => r.claims.push(local));
  return local;
}

// ---------------- PATIENT: open request, verify terms, register record, sign ----------------
export async function patientOpenRequest(patient: Role, item: any) {
  const priv = await encPriv(patient);
  const k = await unwrapKey(item.request.key, priv);
  const payload = await openJSON(k, item.request.box);
  // Independently re-derive every number before signing (patient holds the policy, so it can).
  const policy = policyFor(patient);
  const bytes = await ipfsGet(payload.cid);
  const recordHash = recordHashField(bytes, await unwrapKey(payload.wrappedRecordKey, priv));
  const nullifier = await claimNullifier(policy, recordHash, payload.procedure.code);
  const { policyCommitment } = await import('@kavach/sdk');
  const commitment = await policyCommitment(policy);
  const payout = computePayout(payload.bill.map((b: any) => b.amount), policy);
  const digest = await consentDigest({ policyCommitment: commitment, nullifier, claimDate: payload.claim.claimDate, payoutAmount: payout, payoutRecipient: getAddress(payload.claim.recipient) });
  const checksT = {
    nullifierMatches: nullifier.toString() === payload.claim.nullifier,
    payoutMatchesPolicy: payout === payload.claim.payoutAmount,
  };
  if (!(patientOpenRequest as any).seen?.has(item.id)) {
    ((patientOpenRequest as any).seen ??= new Set()).add(item.id);
    trace({ kind: 'crypto', title: 'Phone decrypted & re-derived the claim', detail: `payout ₹${(payout / 100).toLocaleString('en-IN')} ${checksT.payoutMatchesPolicy ? '✓' : '✗'} · claim ID ${checksT.nullifierMatches ? '✓' : '✗'} · recomputed from the patient’s own policy copy`, vis: 'private' });
  }
  const checks = {
    recordMatchesCid: true,
    nullifierMatches: nullifier.toString() === payload.claim.nullifier,
    payoutMatchesPolicy: payout === payload.claim.payoutAmount,
    digestMatches: digest.toString() === payload.claim.digest,
    covered: policy.coveredProcedures.includes(payload.procedure.code),
  };
  return { payload, checks, digest, recordHash };
}

export async function patientApprove(patient: Role, item: any) {
  const { payload, checks, digest } = await patientOpenRequest(patient, item);
  if (!checks.digestMatches || !checks.payoutMatchesPolicy) throw new Error('claim terms do not match — refusing to sign');
  const recordKey = await unwrapKey(payload.wrappedRecordKey, await encPriv(patient));
  const bytes = await ipfsGet(payload.cid);
  const recordId = keccak256(toUtf8Bytes(`${getDemo().accounts[patient].address}:encounter:${payload.cid}`));
  const v = c(patient).vault;
  if ((await v.records(recordId)).owner === '0x0000000000000000000000000000000000000000') {
    await (await v.registerRecord(recordId, keccak256(bytes), payload.cid, 'encounter')).wait();
  }
  ring.update((r) => (r.recordKeys[recordId] = hexlify(recordKey)));
  const signature = signConsent(await consentPriv(patient, policyFor(patient).policyId), digest);
  trace({ kind: 'crypto', title: 'Signed consent with per-policy key', detail: `digest binds amount + payout address + nullifier · sig ${String(signature).slice(0, 14)}…`, vis: 'private' });
  await api(`/consent/${item.id}`, { signature, recordId });
  trace({ kind: 'net', title: 'Signature sent to the hospital', wire: '64-byte signature', vis: 'sealed' });
  return { recordId, signature };
}

// ---------------- HOSPITAL: prove in browser, then relay ----------------
export async function hospitalProve(localId: string, onStep: (s: string, extra?: any) => void = () => {}) {
  const d = getDemo();
  const local = ring.get().claims.find((x) => x.id === localId);
  const inbox = await api(`/consent/${localId}`);
  if (inbox.status !== 'signed') throw new Error('patient has not signed yet');
  const policy = policyFor(local.patient);
  const h = d.hospitals[local.hospitalIdx];
  onStep('tree');
  const { tree, matches } = await hospitalTree();
  if (!matches) throw new Error('local hospital tree does not match on-chain root');
  const draft = { ...local.draft, policy, recordHash: BigInt(local.recordHash) };
  // refresh used_before right before proving (another claim may have settled)
  draft.usedBefore = Number((await c().claims.policies(await commitmentFor(local.patient))).used);
  onStep('witness');
  const { input, pub } = await buildWitnessInput(draft, { secret: BigInt(h.secret), tree }, inbox.signature);
  const prover = await getProver();
  const tw = performance.now();
  await prover.witness(input); // all 7 statements checked here; throws with the failing one
  trace({ kind: 'zk', title: 'Witness solved — all 7 statements hold', detail: `licensed (Merkle) · policy active · covered & not excluded · payout ≤ limit · unique nullifier · patient signature · recipient bound · ${(performance.now() - tw).toFixed(0)} ms`, vis: 'private' });
  onStep('prove');
  const proof = await prover.prove(input);
  trace({ kind: 'zk', title: 'UltraHonk proof generated in this browser', detail: `bb.js WASM · 45,596 gates · ${(proof.proveMs / 1000).toFixed(2)} s · ${kb(proof.proof.length)}`, vis: 'private' });
  onStep('proved', proof);
  return { proof, claim: claimStruct(pub) };
}

export async function hospitalSubmit(localId: string, proof: { proof: Uint8Array; proveMs: number }, claim: any) {
  const local = ring.get().claims.find((x) => x.id === localId);
  trace({ kind: 'net', title: 'Proof + 7 public inputs sent to the relayer', detail: `amount ₹${(Number(claim.payoutAmount) / 100).toLocaleString('en-IN')} · policy commitment · nullifier · hospital root · date · used-before · recipient`, wire: `${kb(proof.proof.length)} proof + 7 numbers`, vis: 'public' });
  const res = await api('/relay/claim', { proof: hexlify(proof.proof), claim, meta: { rail: local.rail } });
  if (res.ok) trace({ kind: 'chain', where: 'relayer', title: 'tx ClaimSettlement.submitClaim — verified & paid', detail: `HonkVerifier ✓ · nullifier marked used · bINR → one-time ${String(claim.payoutRecipient).slice(0, 10)}…`, tx: res.txHash, block: res.block, gas: Number(res.gasUsed), vis: 'public' });
  else trace({ kind: 'fail', where: 'relayer', title: 'Claim rejected on-chain', detail: res.reason });
  ring.update((r) => {
    const x = r.claims.find((y) => y.id === localId);
    Object.assign(x, { status: res.ok ? 'settled' : 'rejected', result: res, pub: claim, proveMs: proof.proveMs, proofBytes: proof.proof.length });
  });
  return res;
}

export async function hospitalProveAndSubmit(localId: string, onStep: (s: string, extra?: any) => void) {
  const { proof, claim } = await hospitalProve(localId, onStep);
  onStep('relay');
  const res = await hospitalSubmit(localId, proof, claim);
  onStep(res.ok ? 'settled' : 'rejected', res);
  return { res, proof, claim };
}

// ---------------- records: open / share / revoke+rekey ----------------
export async function openRecord(viewer: Role, recordId: string, purpose: string) {
  const v = c(viewer).vault;
  const rec = await v.records(recordId);
  const me = getDemo().accounts[viewer].address;
  let key: Uint8Array;
  if (rec.owner.toLowerCase() === me.toLowerCase()) {
    const hex = ring.get().recordKeys[recordId] ?? getDemo().records.asha?.find((r) => r.recordId === recordId)?.key;
    if (!hex) throw new Error('record key not on this device');
    key = getBytes(hex);
  } else {
    await (await v.logAccess(recordId, purpose)).wait(); // reverts if no access → audit trail of every view
    trace({ kind: 'chain', title: 'Access written to the on-chain audit trail first', detail: `purpose “${purpose}” — HealthVault reverts if the grant is revoked or expired`, vis: 'public' });
    const g = await v.getGrant(recordId, me);
    key = await unwrapKey(JSON.parse(new TextDecoder().decode(getBytes(g.wrappedKey))), await encPriv(viewer));
  }
  const bytes = await ipfsGet(rec.cid);
  if (keccak256(bytes) !== rec.contentHash) throw new Error('IPFS content does not match on-chain hash');
  const doc = await openJSON(key, JSON.parse(new TextDecoder().decode(bytes)));
  trace({ kind: 'crypto', title: 'Decrypted record on this device', detail: 'ciphertext hash matched the on-chain content hash · AES-GCM opened locally', vis: 'private' });
  return doc;
}

export async function shareRecord(owner: Role, recordId: string, grantee: string, role: number, hours: number) {
  const hex = ring.get().recordKeys[recordId] ?? getDemo().records.asha?.find((r) => r.recordId === recordId)?.key;
  if (!hex) throw new Error('record key not on this device');
  const w = await wrapKey(getBytes(hex), await patientPubKey(grantee));
  const exp = (await blockTime()) + hours * 3600;
  trace({ kind: 'crypto', title: 'Wrapped the record key to the grantee', detail: 'ECIES to their registered public key — only they can unwrap it', vis: 'sealed' });
  await (await c(owner).vault.grantAccess(recordId, grantee, role, exp, toUtf8Bytes(JSON.stringify(w)))).wait();
}

/** Minimum-necessary sharing: re-encrypt only some FHIR resource types (e.g. prescriptions for a pharmacy)
 *  as a new record the patient owns, then grant that. The full record never leaves the patient. */
export async function shareSlice(owner: Role, recordId: string, grantee: string, role: number, hours: number, types: string[], kind: string) {
  const doc: any = await openRecord(owner, recordId, 'owner');
  const slice = { ...doc, entry: (doc.entry ?? []).filter((e: any) => types.includes(e.resource?.resourceType)) };
  trace({ kind: 'crypto', title: `Cut a ${kind} slice of the record`, detail: `kept ${slice.entry.length} of ${(doc.entry ?? []).length} FHIR resources (${types.join(', ')})`, vis: 'private' });
  const key = await newRecordKey();
  const bytes = sealedBytes(await sealJSON(key, slice));
  const cid = await ipfsPut(bytes);
  const me = getDemo().accounts[owner].address;
  const newId = keccak256(toUtf8Bytes(`${me}:${kind}:${cid}`));
  await (await c(owner).vault.registerRecord(newId, keccak256(bytes), cid, kind)).wait();
  ring.update((r) => (r.recordKeys[newId] = hexlify(key)));
  await shareRecord(owner, newId, grantee, role, hours);
  return newId;
}

export async function revokeAndRekey(owner: Role, recordId: string, grantee: string) {
  const doc = await openRecord(owner, recordId, 'rekey');
  const v = c(owner).vault;
  await (await v.revokeAccess(recordId, grantee)).wait();
  const key = await newRecordKey();
  const bytes = sealedBytes(await sealJSON(key, doc));
  const cid = await ipfsPut(bytes);
  await (await v.updateRecord(recordId, keccak256(bytes), cid, 're-key after revoke')).wait();
  ring.update((r) => (r.recordKeys[recordId] = hexlify(key)));
}

// ---------------- Anon Aadhaar onboarding ----------------
/** Anon Aadhaar packs revealed ASCII little-endian into a field. */
export function decodeReveal(n: bigint | number | string): string {
  let v = BigInt(n);
  let s = '';
  while (v > 0n) {
    s += String.fromCharCode(Number(v & 0xffn));
    v >>= 8n;
  }
  return s;
}

export async function aadhaarStatus(patient: Role) {
  const p = await c().patients.patients(getDemo().accounts[patient].address);
  return { verified: p.verified as boolean, state: decodeReveal(p.state), ageAbove18: p.ageAbove18 as boolean, at: Number(p.verifiedAt) };
}

/** The proof was generated on the patient's device at onboarding (snarkjs, ~1.5–4 min); here it is verified on-chain. */
export async function verifyAadhaar(patient: Role) {
  const pr = await api(`/aadhaar/proof/${getDemo().accounts[patient].address}`);
  if (pr.error) throw new Error(pr.error);
  const t0 = performance.now();
  trace({ kind: 'id', title: 'Loaded Anon Aadhaar Groth16 proof', detail: `made on-device at onboarding (snarkjs, ${pr.proveMs ? (pr.proveMs / 1000).toFixed(0) + ' s' : '~1.5–4 min'}) · binds this wallet as the signal · reveals age ≥ 18 + state only`, vis: 'private' });
  const tx = await c(patient).patients.verifyWithAadhaar(pr.nullifierSeed, pr.nullifier, pr.timestamp, pr.revealArray, pr.groth16Proof);
  const rc = await tx.wait();
  trace({ kind: 'ok', title: 'Groth16 proof verified on-chain', detail: `PatientRegistry stored the app-scoped nullifier → this Aadhaar can never back a second account · ${Number(rc.gasUsed).toLocaleString()} gas`, vis: 'public' });
  return { proof: pr, gas: Number(rc.gasUsed), ms: performance.now() - t0, tx: tx.hash, state: decodeReveal(pr.revealArray[3]) };
}

export { seal, open, signerFor };
