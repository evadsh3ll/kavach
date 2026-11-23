import { useEffect, useState } from 'react';
import { formatINR, newPolicy, policyCommitment, policyToJSON, toHex32, randomField, consentKeyFor } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Check, Chip, Empty, Hex, Spinner, Stat, useAsync } from '../components/ui';
import { c, events, getDemo, getProvider, blockTime } from '../lib/chain';
import { ring } from '../lib/keyring';

const META = new Map<string, { at: number; gas: number; from: string }>();

export function BlindDesk() {
  const d = getDemo();
  const me = d.accounts.insurer.address;
  useEffect(() => {
    try {
      localStorage.setItem('kavach.insurerSeen', '1');
    } catch {}
  }, []);
  const { data } = useAsync(
    async () => {
      const k = c();
      const [pool, settled, paid, ev, issued] = await Promise.all([
        k.claims.pool(me),
        k.claims.claimsSettled(),
        k.claims.totalPaid(),
        events('claims', 'ClaimSettled', null, null, me),
        events('claims', 'PolicyIssued', null, me),
      ]);
      // a settled claim never changes: fetch its block + receipt once (fewer RPC calls, survives flaky networks)
      const rows = await Promise.all(
        ev.reverse().map(async (e) => {
          if (!META.has(e.transactionHash)) {
            // public RPCs are load-balanced: a lagging node may not have a just-mined block yet → show the row anyway
            const [b, rc] = await Promise.all([getProvider().getBlock(e.blockNumber).catch(() => null), getProvider().getTransactionReceipt(e.transactionHash).catch(() => null)]);
            if (b && rc) META.set(e.transactionHash, { at: b.timestamp, gas: Number(rc.gasUsed), from: rc.from });
            else return { e, at: Math.floor(Date.now() / 1000), gas: 0, from: '' };
          }
          return { e, ...META.get(e.transactionHash)! };
        }),
      );
      return { pool: Number(pool), settled: Number(settled), paid: Number(paid), rows, issued: issued.length };
    },
    [],
    3000,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="Blind Desk · Suraksha Health Insurance"
        sub="Claims arrive as a number and a proof. The contract verified licensing, policy validity, coverage, limits, uniqueness and patient consent — and paid. Nobody here read a medical file."
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Pool balance" value={data ? formatINR(data.pool) : '—'} />
        <Stat label="Claims auto-settled" value={data?.settled ?? '—'} tone="mint" />
        <Stat label="Paid out" value={data ? formatINR(data.paid) : '—'} />
        <Stat label="Policies issued" value={data?.issued ?? '—'} hint="as commitments only" />
      </div>

      <Card title="Settled claims" sub="This is everything the insurer — or anyone reading the chain — learns about a claim.">
        {!data?.rows.length && <Empty>No claims yet. A hospital settles one by proof — nothing to review by hand.</Empty>}
        <div className="space-y-3">
          {(data?.rows ?? []).map(({ e, at, gas, from }) => (
            <div key={e.transactionHash} className="rounded-md border border-line p-4 fade-in">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-2xl font-bold">{formatINR(Number(e.args.payout))}</div>
                  <div className="text-xs text-muted mt-1">
                    {new Date(at * 1000).toLocaleString('en-IN')} · block {e.blockNumber} · {gas.toLocaleString()} gas
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-3 text-xs">
                    <span className="text-muted">policy</span>
                    <Hex v={e.args.policyCommitment} />
                    <span className="text-muted">claim nullifier</span>
                    <Hex v={e.args.nullifier} />
                    <span className="text-muted">paid to</span>
                    <span>
                      <Hex v={e.args.recipient} /> <Chip tone="violet">one-time</Chip>
                    </span>
                    <span className="text-muted">submitted by</span>
                    <span>
                      <Hex v={from} /> <Chip>relayer</Chip>
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="label mb-1">Proven in zero knowledge</div>
                  <Check ok>Hospital is licensed (in registry root)</Check>
                  <Check ok>Policy active on claim date, past waiting period</Check>
                  <Check ok>Procedure covered, diagnosis not excluded</Check>
                  <Check ok>Payout = policy maths, within remaining limit</Check>
                  <Check ok>Never claimed before (nullifier)</Check>
                  <Check ok>Patient signed these exact terms</Check>
                </div>
                <div className="space-y-1.5 min-w-44">
                  <div className="label mb-1">Hidden from us</div>
                  {['Diagnosis', 'Procedure', 'Bill lines', 'Which hospital', 'Patient identity', 'Policy terms'].map((x) => (
                    <div key={x} className="text-sm flex items-center gap-2">
                      <span className="redact px-6 py-0.5 text-xs">xxxx</span> {x}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <IssuePolicy />
    </div>
  );
}

function IssuePolicy() {
  const d = getDemo();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);
  async function issue() {
    setBusy(true);
    try {
      const now = await blockTime();
      const pid = randomField();
      const p = newPolicy({
        policyId: pid,
        planName: 'Arogya Shield Gold (renewal)',
        insurerName: 'Suraksha Health Insurance',
        patientName: d.names.patient2,
        // the patient sends the insurer a fresh per-policy consent key (derived from a wallet signature)
        patientPubKey: consentKeyFor(d.accounts.patient2.privateKey, pid).publicKey,
        startDate: now - 3600,
        endDate: now + 365 * 86400,
        waitingUntil: now - 3600, // continuity benefit: waiting period carried over
        sumInsured: 10_00_000_00,
        deductible: 5_000_00,
        copayBps: 1000,
        coveredProcedures: ['SG039', 'MO012', 'SO051', 'MC011', 'OR004', 'MG053'],
        exclusions: ['Z41.1'],
      });
      const cm = toHex32(await policyCommitment(p));
      await (await c('insurer').claims.issuePolicy(cm)).wait();
      ring.update((r) => (r.policies.patient2 = policyToJSON(p)));
      // the demo keeps Rahul's commitment pointer in sync
      d.policies.rahul = { json: policyToJSON(p), commitment: cm };
      setOut({ cm, p });
    } catch (e: any) {
      alert(e.message);
    }
    setBusy(false);
  }
  return (
    <Card
      title="Issue a policy"
      sub="The full policy goes to the patient. The chain gets one Poseidon2 commitment, and the terms can never be changed afterwards."
      right={
        <button className="btn btn-primary" onClick={issue} disabled={busy}>
          {busy ? <Spinner /> : '＋'} Upgrade {d.names.patient2} to Gold ₹10L
        </button>
      }
    >
      {out ? (
        <div className="text-sm space-y-1 fade-in">
          <div>
            ✓ Issued. On-chain: <Hex v={out.cm} n={12} />
          </div>
          <div className="text-muted">Off-chain to patient: plan, ₹10L sum insured, 6 covered procedures, exclusions, dates, salt. Rahul's waiting period is carried over.</div>
        </div>
      ) : (
        <div className="text-sm text-muted">Rahul's Basic plan is still in its 30-day waiting period, so his claims fail. A renewal with continuity fixes that.</div>
      )}
    </Card>
  );
}
