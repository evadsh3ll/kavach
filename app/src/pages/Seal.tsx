import { useEffect, useState } from 'react';
import { BILL_TEMPLATES, DIAGNOSES, PROCEDURES, computePayout, formatINR } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Chip, Field, Hex, Spinner, Steps, Timer, useAsync } from '../components/ui';
import { c, getDemo, getProvider, Role } from '../lib/chain';
import { api } from '../lib/zk';
import { ring } from '../lib/keyring';
import { hospitalProveAndSubmit, hospitalRequestConsent, policyFor, Rail } from '../lib/flow';
import { useIdentity } from '../lib/session';
import { QrScanner } from '../components/Qr';
import { roleOf } from '../lib/chain';
import { ScanLine, ShieldCheck } from 'lucide-react';

type StepState = 'todo' | 'doing' | 'done' | 'fail';

export function Seal() {
  const d = getDemo();
  const me = useIdentity();
  const hIdx = me?.hospitalIdx ?? 1;
  const [scan, setScan] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [patient, setPatient] = useState<Role>('patient');
  const [diagnosis, setDiag] = useState('C50.9');
  const [diagDisplay, setDiagDisplay] = useState('Breast cancer, unspecified');
  const [procedure, setProc] = useState('MO012');
  const [bill, setBill] = useState(BILL_TEMPLATES.MO012);
  const [rail, setRail] = useState<Rail>('stealth');
  const [ua, setUa] = useState('');
  const [active, setActive] = useState<any>(null);
  const [steps, setSteps] = useState<Record<string, StepState>>({});
  const [result, setResult] = useState<any>(null);
  const [proof, setProof] = useState<any>(null);
  const [err, setErr] = useState('');
  const [proving, setProving] = useState(false);

  useEffect(() => setBill(BILL_TEMPLATES[procedure] ?? BILL_TEMPLATES.SG039), [procedure]);
  // Resume an in-flight claim for this hospital (e.g. after visiting the Vault to sign).
  useEffect(() => {
    const pending = ring
      .get()
      .claims.filter((x) => x.hospitalIdx === hIdx && x.status === 'awaiting-consent')
      .at(-1);
    if (pending && pending.id !== active?.id) {
      setActive(pending);
      setPatient(pending.patient);
      setDiag(pending.diagnosis.code);
      setDiagDisplay(pending.diagnosis.display);
      setProc(pending.procedure.code);
      setRail(pending.rail);
      setResult(null);
      setProof(null);
      setSteps({ record: 'done', consent: 'doing' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hIdx]);
  const policy = policyFor(patient);
  const payout = computePayout(bill.map((b) => b.amount), policy);
  const total = bill.reduce((a, b) => a + b.amount, 0);

  // poll consent status
  const consent = useAsync(async () => (active ? api(`/consent/${active.id}`) : null), [active?.id], 1500);
  const signed = consent.data?.status === 'signed';

  const set = (k: string, v: StepState) => setSteps((s) => ({ ...s, [k]: v }));

  async function request() {
    setErr('');
    setResult(null);
    setProof(null);
    setSteps({ record: 'doing' });
    try {
      const local = await hospitalRequestConsent({ hospitalIdx: hIdx, patient, diagnosis, diagnosisDisplay: diagDisplay, procedure, bill, rail, zcashUA: ua || undefined });
      setActive(local);
      setSteps({ record: 'done', consent: 'doing' });
    } catch (e: any) {
      setErr(e.message);
      set('record', 'fail');
    }
  }

  useEffect(() => {
    if (signed && steps.consent === 'doing') set('consent', 'done');
  }, [signed]);

  async function prove() {
    setProving(true);
    setErr('');
    try {
      const { res } = await hospitalProveAndSubmit(active.id, (s, extra) => {
        if (s === 'tree') set('tree', 'doing');
        if (s === 'witness') (set('tree', 'done'), set('witness', 'doing'));
        if (s === 'prove') (set('witness', 'done'), set('prove', 'doing'));
        if (s === 'proved') (set('prove', 'done'), setProof(extra));
        if (s === 'relay') set('relay', 'doing');
        if (s === 'settled') set('relay', 'done');
        if (s === 'rejected') set('relay', 'fail');
      });
      setResult(res);
      if (!res.ok) setErr(res.reason);
    } catch (e: any) {
      setErr(e.message);
      setSteps((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === 'doing' ? 'fail' : v])));
    }
    setProving(false);
  }

  const st = (k: string): StepState => steps[k] ?? 'todo';
  const hosp = d.hospitals[hIdx];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${hosp.name} · claim desk`}
        sub="Write the encounter, get the patient’s signature, prove the claim in this browser. Nothing medical leaves this machine unencrypted — and this hospital never sends a transaction itself."
        right={
          <div className="text-right text-[12px] text-muted">
            <div className="label">ABDM HFR</div>
            <div className="mono">{hosp.hfrId}</div>
            <div>{hosp.city}</div>
          </div>
        }
      />
      <div className="grid lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3" title="1 · Encounter" sub={`${hosp.name}, ${hosp.city} · ABDM HFR ${hosp.hfrId}`}>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Patient (scan their Mohar card)">
              <div className="flex gap-2">
                <select className="input" value={patient} onChange={(e) => setPatient(e.target.value as Role)}>
                  <option value="patient">{d.names.patient} — {policyFor('patient').planName}</option>
                  <option value="patient2">{d.names.patient2} — {policyFor('patient2').planName}</option>
                </select>
                <button type="button" className="btn btn-ghost !px-2.5" title="Scan patient card" onClick={() => setScan(true)}>
                  <ScanLine size={16} />
                </button>
              </div>
              {scanMsg && <div className="text-[12px] text-mint mt-1">{scanMsg}</div>}
            </Field>
            <div className="sm:col-span-1">
              <IcdPicker code={diagnosis} display={diagDisplay} onPick={(c, d) => (setDiag(c), setDiagDisplay(d))} />
            </div>
            <Field label="Procedure (private)">
              <select className="input" value={procedure} onChange={(e) => setProc(e.target.value)}>
                {PROCEDURES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} · {x.display} {policy.coveredProcedures.includes(x.code) ? '' : ' (not covered)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payout rail (Ghost Pay)">
              <div className="flex gap-1 card p-1 !rounded-md">
                {(['stealth', 'zcash'] as Rail[]).map((r) => (
                  <button key={r} onClick={() => setRail(r)} className={`flex-1 px-3 py-1.5 rounded-lg text-sm ${rail === r ? 'bg-text text-ink' : 'text-muted'}`}>
                    {r === 'stealth' ? 'One-time address' : 'Zcash shielded'}
                  </button>
                ))}
              </div>
            </Field>
            {rail === 'zcash' && (
              <div className="sm:col-span-2">
                <Field label="Hospital's Zcash testnet unified address (utest1…)">
                  <input className="input mono" value={ua} onChange={(e) => setUa(e.target.value)} placeholder="utest1…" />
                </Field>
              </div>
            )}
          </div>
          <div className="mt-5">
            <div className="label mb-2">Itemised bill (private)</div>
            <div className="space-y-1.5">
              {bill.map((b, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input" value={b.label} onChange={(e) => setBill(bill.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <input
                    className="input w-40 text-right mono"
                    value={b.amount / 100}
                    onChange={(e) => setBill(bill.map((x, j) => (j === i ? { ...x, amount: Math.round(+e.target.value * 100) || 0 } : x)))}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-4 text-sm">
              <div className="text-muted">Total <b className="text-fg">{formatINR(total)}</b> − deductible {formatINR(policy.deductible)} − co-pay {policy.copayBps / 100}%
              </div>
              <div>Insurer pays <b className="text-mint text-lg">{formatINR(payout)}</b>
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button className="btn btn-primary" onClick={request} disabled={st('record') === 'doing'}>
              {st('record') === 'doing' ? <Spinner /> : null} Seal record & request consent
            </button>
          </div>
        </Card>

        <Card className="lg:col-span-2" title="2 · Prove & settle" sub="UltraHonk proof generated locally with bb.js (WASM)">
          <Steps
            steps={[
              { label: 'Encrypt FHIR record, pin to IPFS', state: st('record'), detail: active && <span className="mono">{active.cid.slice(0, 22)}…</span> },
              {
                label: 'Patient signs consent',
                state: st('consent'),
                detail: st('consent') === 'doing' ? <span className="text-amber">waiting for {d.names[patient]} to sign on their phone (sign in as the patient)…</span> : signed ? 'signature received' : undefined,
              },
              { label: 'Rebuild hospital Merkle tree, match on-chain root', state: st('tree') },
              { label: 'Compute witness (all 7 statements checked)', state: st('witness') },
              {
                label: 'Generate zero-knowledge proof',
                state: st('prove'),
                detail: st('prove') === 'doing' ? <Timer running /> : proof ? `${(proof.proveMs / 1000).toFixed(2)}s · ${proof.proof.length.toLocaleString()} bytes` : undefined,
              },
              { label: 'Relayer submits · contract verifies · pays', state: st('relay'), detail: result?.ok && `block ${result.block} · ${Number(result.gasUsed).toLocaleString()} gas` },
            ]}
          />
          <button className="btn btn-primary w-full justify-center mt-5" disabled={!signed || proving || st('relay') === 'done'} onClick={prove}>
            {proving ? <Spinner /> : null} Generate proof & submit
          </button>
          {err && <div className="mt-3 text-sm text-rose bg-rose/10 rounded-lg p-3">{err}</div>}
          {result?.ok && <Settled claim={ring.get().claims.find((x) => x.id === active.id)} />}
        </Card>
      </div>
      <HapiImport onUse={(c, d) => (setDiag(c), setDiagDisplay(d))} />
      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Scan the patient’s Mohar card"
        hint="Patient → My QR codes → Mohar card. It carries the patient’s address only, so the consent request can be sealed to them."
        demo={{ label: 'Demo: Asha’s card', value: JSON.stringify({ app: 'kavach', t: 'patient-card', patient: d.accounts.patient.address }) }}
        onResult={(t) => {
          try {
            const j = JSON.parse(t);
            const r = roleOf(j.patient);
            if (r === 'patient' || r === 'patient2') {
              setPatient(r);
              setScanMsg(`Card scanned: ${d.names[r]} · ${policyFor(r).planName}`);
            } else setScanMsg('Unknown patient');
          } catch {
            setScanMsg('Not a Mohar card');
          }
        }}
      />
      <GhostWallets hIdx={hIdx} />
    </div>
  );
}

function Settled({ claim }: { claim: any }) {
  if (!claim?.pub) return null;
  return (
    <div className="mt-4 rounded-md border border-mint/40 bg-mint/5 p-4 fade-in">
      <div className="text-mint font-bold flex items-center gap-2"><ShieldCheck size={16} /> Settled · {formatINR(claim.pub.payoutAmount)}</div>
      <div className="text-xs text-muted mt-1"> paid to {claim.rail === 'zcash' ? 'the Ghost Pay bridge → Zcash shielded pool' : 'one-time address'} <Hex v={claim.pub.payoutRecipient} />
      </div>
      <a className="text-xs text-violet mt-2 inline-block" href="#/xray">See what the chain learned →
      </a>
    </div>
  );
}

function GhostWallets({ hIdx }: { hIdx: number }) {
  const { data } = useAsync(
    async () => {
      const mine = ring.get().claims.filter((x) => x.hospitalIdx === hIdx && x.status === 'settled' && x.rail === 'stealth');
      return Promise.all(mine.map(async (x) => ({ ...x, bal: Number(await c().token.balanceOf(x.pub.payoutRecipient)) })));
    },
    [hIdx],
    5000,
  );
  const gp = useAsync(() => api('/ghostpay'), [], 5000);
  if (!data?.length && !gp.data?.payouts?.length) return null;
  return (
    <Card title="Ghost Pay receivables" sub="Each claim paid a fresh address derived from this hospital's secret + the claim nullifier. Only this desk can link them.">
      <div className="space-y-2">
        {(data ?? []).map((x) => (
          <div key={x.id} className="flex justify-between text-sm border-b border-line pb-2">
            <span>
              {x.procedure.display} · {x.patient === 'patient' ? 'Asha' : 'Rahul'}
            </span>
            <span className="flex gap-3 items-center">
              <Hex v={x.pub.payoutRecipient} />
              <b className="text-mint">{formatINR(x.bal)}</b>
            </span>
          </div>
        ))}
        {(gp.data?.payouts ?? []).map((p: any) => (
          <div key={p.nullifier} className="flex justify-between text-sm border-b border-line pb-2">
            <span>Zcash → {p.ua.slice(0, 14)}…</span>
            <Chip tone={p.status === 'sent' ? 'mint' : p.status === 'failed' ? 'rose' : 'amber'}>{p.status}</Chip>
          </div>
        ))}
      </div>
    </Card>
  );
}

export const _unused = getProvider;

function IcdPicker({ code, display, onPick }: { code: string; display: string; onPick: (c: string, d: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useAsync(async () => (q.length >= 2 ? api(`/icd10?q=${encodeURIComponent(q)}`) : null), [q]);
  return (
    <div className="relative">
      <div className="label mb-1.5">Diagnosis · ICD-10 (private)</div>
      <input
        className="input"
        placeholder="type a code or plain words: “breast cancer”, “heart attack”"
        value={open ? q : `${code} · ${display}`}
        onFocus={() => (setOpen(true), setQ(''))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && data?.results?.length > 0 && (
        <div className="absolute z-20 mt-1 w-[520px] max-w-[80vw] card p-1 max-h-72 overflow-auto shadow-xl">
          <div className="px-2 py-1 text-[11px] text-muted">
            {data.total.toLocaleString()} ICD-10-CM codes · offline · {data.results[0].why !== 'text' && data.results[0].why !== 'code' ? `understood “${data.results[0].why}”` : 'smart search'}
          </div>
          {data.results.map((r: any) => (
            <button key={r.code} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-panel2 text-[13px] flex gap-3" onMouseDown={() => (onPick(r.code, r.desc), setOpen(false))}>
              <span className="mono w-16 shrink-0 text-sky">{r.code}</span>
              <span>{r.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HapiImport({ onUse }: { onUse: (code: string, display: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<any>(null);
  const [icd, setIcd] = useState<any>(null);
  const [err, setErr] = useState('');
  async function load() {
    setBusy(true);
    setErr('');
    try {
      const x = await api('/fhir/hapi');
      if (x.error) throw new Error(x.error);
      setR(x);
      setIcd(await api(`/icd10?q=${encodeURIComponent(x.condition.display)}`));
    } catch (e: any) {
      setErr(e.message);
    }
    setBusy(false);
  }
  return (
    <Card
      title="Cross-hospital record import · HL7 FHIR R4"
      sub="Pull a live Condition + Patient from the public HAPI FHIR test server (another provider's system), then map its SNOMED code to ICD-10 for the claim."
      right={
        <button className="btn btn-ghost" onClick={load} disabled={busy}>
          {busy ? <Spinner /> : null} Import from HAPI FHIR
        </button>
      }
    >
      {err && <div className="text-sm text-rose">{err}</div>}
      {r && (
        <div className="grid md:grid-cols-2 gap-5 text-[13px] fade-in">
          <div className="space-y-1.5">
            <div className="label">Received FHIR resources</div>
            <div>
              Patient <b>{r.patient.name}</b> · {r.patient.gender} · born {r.patient.birthDate ?? '—'}
            </div>
            <div>
              Condition <span className="mono text-sky">{r.condition.code}</span> · {r.condition.display}
            </div>
            <div className="text-muted text-[12px]">system {r.condition.system}</div>
            <a className="text-[12px] text-sky underline" href={r.source} target="_blank" rel="noreferrer">
              {r.source}
            </a>
          </div>
          <div>
            <div className="label mb-1.5">Suggested ICD-10 for the claim</div>
            {(icd?.results ?? []).slice(0, 4).map((x: any) => (
              <button key={x.code} className="w-full text-left flex gap-3 px-2 py-1.5 rounded-lg hover:bg-panel2" onClick={() => onUse(x.code, x.desc)}>
                <span className="mono w-16 text-sky">{x.code}</span>
                <span>{x.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
