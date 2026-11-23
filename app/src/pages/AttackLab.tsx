import { useState } from 'react';
import { hexlify, Wallet } from 'ethers';
import {
  BILL_TEMPLATES,
  Policy,
  buildWitnessInput,
  circuitFailureReason,
  claimNullifier,
  ghostWallet,
  policyFromJSON,
  prepareClaim,
  randomField,
  signConsent,
  consentKeyFor,
} from '@kavach/sdk';
import { PageHeader } from '../App';
import { BadgeCheck, Copy, Fingerprint, Hospital, Hourglass, Ban, FileX2, IndianRupee, Scissors, PenOff, TrendingUp, Shuffle, TreePine, CalendarX2, UserX } from 'lucide-react';
import { verifyAadhaar } from '../lib/flow';
import { Card, Chip, Spinner } from '../components/ui';
import { c, getDemo, blockTime, revertReason } from '../lib/chain';
import { api, claimStruct, getProver, hospitalTree } from '../lib/zk';
import { commitmentFor, policyFor } from '../lib/flow';

type Outcome = { layer: 'circuit' | 'contract' | 'ok'; reason: string; ms: number };

interface Opts {
  policy?: Policy;
  secret?: string;
  procedure?: string;
  diagnosis?: string;
  bill?: number[];
  claimDate?: number;
  signer?: string;
  usedBeforeDelta?: number;
}

async function build(o: Opts = {}) {
  const d = getDemo();
  const policy = o.policy ?? policyFor('patient');
  const secret = BigInt(o.secret ?? d.hospitals[0].secret);
  const { tree } = await hospitalTree();
  const recordHash = randomField();
  const procedure = o.procedure ?? 'SG039';
  const nullifier = await claimNullifier(policy, recordHash, procedure);
  const cm = o.policy ? null : await commitmentFor('patient');
  const used = cm ? Number((await c().claims.policies(cm)).used) : 0;
  const draft = {
    policy,
    diagnosis: o.diagnosis ?? 'K35.80',
    procedure,
    recordHash,
    billItems: o.bill ?? BILL_TEMPLATES.SG039.map((b) => b.amount),
    claimDate: o.claimDate ?? (await blockTime()),
    usedBefore: o.usedBeforeDelta !== undefined ? (used > 0 ? 0 : 1) : used, // lie: pretend nothing was used yet
    recipient: ghostWallet(secret, nullifier).address,
  };
  const prep = await prepareClaim(draft);
  const sig = signConsent(o.signer ?? consentKeyFor(d.accounts.patient.privateKey, policy.policyId).privateKey, prep.digest);
  return buildWitnessInput(draft, { secret, tree }, sig);
}

async function circuitThenContract(o: Opts, tamper?: (cl: any) => void, submit = false): Promise<Outcome> {
  const t0 = performance.now();
  const { input, pub } = await build(o);
  const prover = await getProver();
  try {
    await prover.witness(input);
  } catch (e) {
    return { layer: 'circuit', reason: circuitFailureReason(e), ms: performance.now() - t0 };
  }
  const p = await prover.prove(input);
  const claim = claimStruct(pub);
  tamper?.(claim);
  const r = await api(submit ? '/relay/claim' : '/relay/simulate', { proof: hexlify(p.proof), claim });
  if (r.ok) return { layer: 'ok', reason: submit ? `settled in block ${r.block}` : 'would settle', ms: performance.now() - t0 };
  return { layer: 'contract', reason: r.reason, ms: performance.now() - t0 };
}

async function replay(): Promise<Outcome> {
  const t0 = performance.now();
  const last = await api('/relay/last');
  if (!last) return { layer: 'ok', reason: 'No settled claim yet. Run the honest claim first.', ms: 0 };
  const r = await api('/relay/simulate', { proof: last.proof, claim: last.claim });
  return r.ok ? { layer: 'ok', reason: 'accepted?!', ms: 0 } : { layer: 'contract', reason: r.reason, ms: performance.now() - t0 };
}

const ICON: Record<string, any> = { honest: BadgeCheck, replay: Copy, fake: Hospital, expired: CalendarX2, waiting: Hourglass, uncovered: Ban, excluded: FileX2, limit: IndianRupee, split: Scissors, forged: PenOff, inflate: TrendingUp, frontrun: Shuffle, root: TreePine, aadhaarDup: Fingerprint, aadhaarSteal: UserX };

async function aadhaarAttack(kind: 'dup' | 'steal'): Promise<Outcome> {
  const t0 = performance.now();
  const d = getDemo();
  const asha = await c().patients.patients(d.accounts.patient.address);
  if (!asha.verified) await verifyAadhaar('patient'); // Asha onboards honestly first
  // dup: Rahul's OWN valid proof, but generated from the same Aadhaar → same nullifier
  // steal: Rahul submits Asha's proof (bound to Asha's wallet)
  const pr = await api(`/aadhaar/proof/${(kind === 'dup' ? d.accounts.patient2 : d.accounts.patient).address}`);
  try {
    await c('patient2').patients.verifyWithAadhaar.staticCall(pr.nullifierSeed, pr.nullifier, pr.timestamp, pr.revealArray, pr.groth16Proof);
    return { layer: 'ok', reason: 'accepted?!', ms: performance.now() - t0 };
  } catch (e) {
    return { layer: 'contract', reason: revertReason(e), ms: performance.now() - t0 };
  }
}

const SCENARIOS: { id: string; icon: string; title: string; how: string; run: () => Promise<Outcome> }[] = [
  { id: 'honest', icon: '', title: 'Honest claim (control)', how: 'Licensed hospital, active policy, covered appendicectomy, patient signed.', run: () => circuitThenContract({}, undefined, true) },
  { id: 'replay', icon: '', title: 'Replay a settled claim', how: 'Resubmit the exact proof that was just paid.', run: replay },
  { id: 'fake', icon: '', title: 'Unlicensed hospital', how: '"Shady Clinic" was never approved by the regulator.', run: () => circuitThenContract({ secret: getDemo().shadyClinic.secret }) },
  {
    id: 'expired',
    icon: '⌛',
    title: 'Expired policy',
    how: 'Treatment dated after the policy end date.',
    run: async () => circuitThenContract({ claimDate: policyFor('patient').endDate + 86400 }),
  },
  {
    id: 'waiting',
    icon: '⏳',
    title: 'Inside waiting period',
    how: "Rahul's new Basic policy is still in its 30-day waiting period.",
    run: () => {
      const pol = policyFromJSON(getDemo().policies.rahul.json);
      return circuitThenContract({ policy: pol, signer: consentKeyFor(getDemo().accounts.patient2.privateKey, pol.policyId).privateKey });
    },
  },
  { id: 'uncovered', icon: '', title: 'Uncovered procedure', how: 'Cosmetic rhinoplasty billed on a health policy.', run: () => circuitThenContract({ procedure: 'PL007', diagnosis: 'Z41.1' }) },
  { id: 'excluded', icon: '', title: 'Excluded diagnosis', how: 'Covered procedure, but the diagnosis (infertility N97.9) is a policy exclusion.', run: () => circuitThenContract({ diagnosis: 'N97.9' }) },
  { id: 'limit', icon: '', title: 'Over the limit', how: '₹7 lakh bill on a ₹5 lakh policy.', run: () => circuitThenContract({ bill: [70000000] }) },
  { id: 'split', icon: '', title: 'Lie about prior usage', how: 'Prove against a smaller "already used" amount to dodge the cap (claim splitting).', run: () => circuitThenContract({ usedBeforeDelta: 1 }) },
  { id: 'forged', icon: '', title: 'Fake patient consent', how: 'Hospital signs for the patient with its own key.', run: () => circuitThenContract({ signer: Wallet.createRandom().privateKey }) },
  { id: 'inflate', icon: '', title: 'Inflate payout after proving', how: 'Valid proof, then bump the public amount by ₹10,000.', run: () => circuitThenContract({}, (cl) => (cl.payoutAmount += 1000000)) },
  { id: 'frontrun', icon: '', title: 'Front-run the payout', how: 'A mempool watcher swaps the recipient to their own address.', run: () => circuitThenContract({}, (cl) => (cl.payoutRecipient = Wallet.createRandom().address)) },
  { id: 'aadhaarDup', icon: '', title: 'One Aadhaar, two accounts', how: 'Rahul presents a valid Anon Aadhaar proof made from the same Aadhaar Asha already used.', run: () => aadhaarAttack('dup') },
  { id: 'aadhaarSteal', icon: '', title: 'Stolen identity proof', how: 'Rahul replays Asha’s Aadhaar proof from his own wallet.', run: () => aadhaarAttack('steal') },
  { id: 'root', icon: '', title: 'Forged hospital registry', how: 'Claim against a self-made Merkle root.', run: () => circuitThenContract({}, (cl) => (cl.hospitalRoot = '0x' + randomField().toString(16).padStart(64, '0'))) },
];

const EXPLAIN: Record<string, string> = {
  NullifierUsed: 'The nullifier H(policy salt, record, procedure) was already spent.',
  InvalidProof: 'The proof is bound to every public input; change one and verification fails.',
  StaleUsedAmount: 'The contract feeds its own "already used" counter into the proof.',
  UnknownHospitalRoot: 'Only roots published by the regulator are accepted.',
  DuplicateAadhaar: 'Anon Aadhaar nullifier is app-scoped and unique per Aadhaar: one person, one account.',
  InvalidAadhaarProof: 'The Aadhaar proof is bound to the wallet that made it (signal = address).',
};

export function AttackLab() {
  const [res, setRes] = useState<Record<string, Outcome | 'running'>>({});
  const [all, setAll] = useState(false);
  async function run(s: (typeof SCENARIOS)[number]) {
    setRes((r) => ({ ...r, [s.id]: 'running' }));
    try {
      const o = await s.run();
      setRes((r) => ({ ...r, [s.id]: o }));
    } catch (e: any) {
      setRes((r) => ({ ...r, [s.id]: { layer: 'circuit', reason: e.message, ms: 0 } }));
    }
  }
  async function runAll() {
    setAll(true);
    for (const s of SCENARIOS) await run(s);
    setAll(false);
  }
  const blocked = Object.values(res).filter((r) => r !== 'running' && r.layer !== 'ok').length;
  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="Attack Lab"
        sub="Every button is a real fraud attempt against the real circuit and the deployed contract. Nothing here is mocked."
        right={
          <div className="flex items-center gap-3">
            {blocked > 0 && <Chip tone="rose">{blocked} attacks blocked</Chip>}
            <button className="btn btn-primary" onClick={runAll} disabled={all}>
              {all ? <Spinner /> : null} Run all
            </button>
          </div>
        }
      />
      <div className="grid md:grid-cols-2 gap-4">
        {SCENARIOS.map((s) => {
          const r = res[s.id];
          const done = r && r !== 'running';
          const ok = done && r.layer === 'ok';
          return (
            <Card key={s.id}>
              <div className="flex justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {s.title}
                  </div>
                  <div className="text-sm text-muted mt-1">{s.how}</div>
                </div>
                <button className="btn btn-ghost !py-1.5 shrink-0" onClick={() => run(s)} disabled={r === 'running'}>
                  {r === 'running' ? <Spinner /> : 'Run'}
                </button>
              </div>
              {done && (
                <div className="mt-3 text-sm fade-in">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip tone={ok ? 'mint' : 'rose'}>{ok ? 'SETTLED' : 'BLOCKED'}</Chip>
                    {!ok && <span className="text-[12.5px] text-muted">{r.layer === 'circuit' ? 'by the ZK circuit: no proof can exist' : 'by the smart contract'}</span>}
                    {r.ms > 0 && <span className="text-xs text-muted mono">{(r.ms / 1000).toFixed(1)}s</span>}
                  </div>
                  <div className={`mt-2 mono text-[12.5px] ${ok ? 'text-mint' : 'text-rose'}`}>{r.reason}</div>
                  {EXPLAIN[r.reason] && <div className="text-xs text-muted mt-1">{EXPLAIN[r.reason]}</div>}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
