// Build a claim: nullifier, consent digest, patient signature and the full Noir witness input.
import { SigningKey, Wallet, keccak256, AbiCoder, getAddress, getBytes } from 'ethers';
import { DOM, codeToField, poseidon2, toHex32 } from './hash.js';
import { MerkleTree } from './merkle.js';
import {
  HOSP_DEPTH,
  N_ITEMS,
  Policy,
  computePayout,
  coveredTree,
  exclusionFields,
  policyCommitment,
  procedureLeaf,
  splitPubKey,
} from './policy.js';

export interface ClaimDraft {
  policy: Policy;
  diagnosis: string; // ICD-10, private
  procedure: string; // procedure code, private
  recordHash: bigint; // hash of the encrypted FHIR record, private
  billItems: number[]; // paise, private
  claimDate: number; // unix seconds, public
  usedBefore: number; // from contract, public
  recipient: string; // EVM address (Ghost Pay one-time address), public
}

export interface ClaimPublic {
  hospitalRoot: bigint;
  policyCommitment: bigint;
  nullifier: bigint;
  claimDate: number;
  usedBefore: number;
  payoutAmount: number;
  payoutRecipient: string;
}

export async function claimNullifier(policy: Policy, recordHash: bigint, procedure: string) {
  return poseidon2([DOM.NULLIFIER, policy.salt, recordHash, codeToField(procedure)]);
}

export async function consentDigest(pub: Omit<ClaimPublic, 'hospitalRoot' | 'usedBefore'>): Promise<bigint> {
  return poseidon2([
    DOM.CONSENT,
    pub.nullifier,
    BigInt(pub.payoutAmount),
    BigInt(pub.payoutRecipient),
    BigInt(pub.claimDate),
    pub.policyCommitment,
  ]);
}

/**
 * Per-policy consent key, derived from a wallet signature (works with MetaMask's personal_sign too).
 * The wallet's own public key is visible on-chain once it transacts; the consent key never is, so a
 * policy commitment cannot be linked to the patient's wallet even by brute-forcing known keys.
 */
export const consentKeyMessage = (policyId: bigint) => `Mohar consent key v1\npolicy ${toHex32(policyId)}`;
export function consentKeyFromSignature(signature: string): SigningKey {
  return new SigningKey(keccak256(getBytes(signature)));
}
export function consentKeyFor(walletPrivKey: string, policyId: bigint): SigningKey {
  return consentKeyFromSignature(new Wallet(walletPrivKey).signMessageSync(consentKeyMessage(policyId)));
}

/** Per-wallet ENCRYPTION key (ECIES), derived from a wallet signature over a fixed message.
 *  MetaMask can't decrypt for us, but personal_sign is deterministic (RFC 6979), so any wallet —
 *  MetaMask or a raw key — reproduces the same key on demand, and it never touches the chain. */
export const encryptionKeyMessage = 'Mohar encryption key v1\n\nSigning this derives your private decryption key on this device. It is never sent anywhere.';
export function encryptionKeyFromSignature(signature: string): SigningKey {
  return new SigningKey(keccak256(getBytes(signature)));
}
export function encryptionKeyFor(walletPrivKey: string): SigningKey {
  return encryptionKeyFromSignature(new Wallet(walletPrivKey).signMessageSync(encryptionKeyMessage));
}

/** Patient side: sign the exact claim terms (raw digest, no Ethereum prefix — verified in-circuit). */
export function signConsent(patientPrivKey: string, digest: bigint): string {
  const sig = new SigningKey(patientPrivKey).sign(toHex32(digest));
  return sig.r + sig.s.slice(2); // 64 bytes r||s, s is low-S normalised by ethers
}

/** Hospital side: everything needed to ask the patient for consent. */
export async function prepareClaim(d: ClaimDraft) {
  const payoutAmount = computePayout(d.billItems, d.policy);
  const commitment = await policyCommitment(d.policy);
  const nullifier = await claimNullifier(d.policy, d.recordHash, d.procedure);
  const pub = {
    policyCommitment: commitment,
    nullifier,
    claimDate: d.claimDate,
    payoutAmount,
    payoutRecipient: getAddress(d.recipient),
  };
  return { ...pub, digest: await consentDigest(pub) };
}

const hex = (b: Uint8Array) => Array.from(b);

export async function buildWitnessInput(
  d: ClaimDraft,
  hospital: { secret: bigint; tree: MerkleTree },
  consentSig: string,
) {
  if (d.billItems.length > N_ITEMS) throw new Error(`max ${N_ITEMS} bill items`);
  const items = [...d.billItems];
  while (items.length < N_ITEMS) items.push(0);

  const prep = await prepareClaim(d);
  const hospLeaf = await poseidon2([DOM.HOSPITAL, hospital.secret]);
  const hIdx = hospital.tree.indexOf(hospLeaf);
  // A non-member still gets a (useless) path so the Attack Lab can show the proof failing.
  const hProof = hIdx >= 0 ? hospital.tree.proof(hIdx) : { index: 0, path: Array(HOSP_DEPTH).fill(0n), root: hospital.tree.root };

  const cTree = await coveredTree(d.policy);
  const pLeaf = await procedureLeaf(d.procedure);
  const pIdx = cTree.indexOf(pLeaf);
  const pProof = pIdx >= 0 ? cTree.proof(pIdx) : { index: 0, path: Array(cTree.depth).fill(0n) };

  const { x, y } = splitPubKey(d.policy.patientPubKey);
  const sigBytes = getBytes('0x' + consentSig.replace(/^0x/, ''));

  const pub: ClaimPublic = {
    hospitalRoot: hospital.tree.root,
    policyCommitment: prep.policyCommitment,
    nullifier: prep.nullifier,
    claimDate: d.claimDate,
    usedBefore: d.usedBefore,
    payoutAmount: prep.payoutAmount,
    payoutRecipient: prep.payoutRecipient,
  };

  const f = (v: bigint) => toHex32(v);
  const input = {
    hospital_root: f(pub.hospitalRoot),
    policy_commitment: f(pub.policyCommitment),
    nullifier: f(pub.nullifier),
    claim_date: String(pub.claimDate),
    used_before: String(pub.usedBefore),
    payout_amount: String(pub.payoutAmount),
    payout_recipient: f(BigInt(pub.payoutRecipient)),
    hospital_secret: f(hospital.secret),
    hospital_index: String(hProof.index),
    hospital_path: hProof.path.map(f),
    policy_id: f(d.policy.policyId),
    patient_pub_x: hex(x),
    patient_pub_y: hex(y),
    start_date: String(d.policy.startDate),
    end_date: String(d.policy.endDate),
    waiting_until: String(d.policy.waitingUntil),
    sum_insured: String(d.policy.sumInsured),
    deductible: String(d.policy.deductible),
    copay_bps: String(d.policy.copayBps),
    covered_root: f(cTree.root),
    exclusions: exclusionFields(d.policy).map(f),
    policy_salt: f(d.policy.salt),
    diagnosis_code: f(codeToField(d.diagnosis)),
    procedure_code: f(codeToField(d.procedure)),
    procedure_index: String(pProof.index),
    procedure_path: pProof.path.map(f),
    record_hash: f(d.recordHash),
    bill_items: items.map(String),
    consent_sig: hex(sigBytes),
  };
  return { input, pub };
}

/** Ordered public inputs exactly as the Solidity verifier expects them. */
export function publicInputsArray(pub: ClaimPublic): string[] {
  return [
    toHex32(pub.hospitalRoot),
    toHex32(pub.policyCommitment),
    toHex32(pub.nullifier),
    toHex32(BigInt(pub.claimDate)),
    toHex32(BigInt(pub.usedBefore)),
    toHex32(BigInt(pub.payoutAmount)),
    toHex32(BigInt(pub.payoutRecipient)),
  ];
}

// ---------------- Ghost Pay: one-time payout addresses ----------------
/**
 * Each claim pays a fresh address derived from the hospital's secret + nullifier.
 * Nobody else can link it to the hospital; the hospital can re-derive the key and sweep.
 */
export function ghostWallet(hospitalSecret: bigint, nullifier: bigint): Wallet {
  const pk = keccak256(AbiCoder.defaultAbiCoder().encode(['string', 'uint256', 'uint256'], ['kavach/ghostpay/v1', hospitalSecret, nullifier]));
  return new Wallet(pk);
}

/** Recipient is chosen before the nullifier is final? No — nullifier is deterministic, so derive it first. */
export async function ghostRecipient(hospitalSecret: bigint, policy: Policy, recordHash: bigint, procedure: string) {
  const n = await claimNullifier(policy, recordHash, procedure);
  return ghostWallet(hospitalSecret, n);
}

export const hospitalLeaf = (secret: bigint) => poseidon2([DOM.HOSPITAL, secret]);
