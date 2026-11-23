import { useEffect, useState } from 'react';
import { formatINR, PROCEDURES, policyCommitment, toHex32 } from '@kavach/sdk';
import { Eye, Fingerprint, FileHeart, FilePlus2, KeyRound, LifeBuoy, Lock, ScanLine, ShieldAlert, ShieldCheck, Share2, Siren, Undo2, UserCheck } from 'lucide-react';
import { PageHeader } from '../App';
import { Card, Check, Chip, Empty, Hex, Redacted, Spinner, Stat, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { QrImage, QrScanner } from '../components/Qr';
import { c, events, getDemo, nameOf, revertReason, Role, short } from '../lib/chain';
import { api } from '../lib/zk';
import { openRecord, patientApprove, patientOpenRequest, policyFor, revokeAndRekey, shareRecord, shareSlice, aadhaarStatus, verifyAadhaar } from '../lib/flow';
import { useIdentity } from '../lib/session';
import { trace } from '../lib/trace';

const ROLE_NAMES = ['—', 'Doctor', 'Hospital', 'Lab', 'Pharmacy', 'Emergency'];

const dupOwner = (e: any) => {
  const data: string = e?.data ?? e?.info?.error?.data ?? '';
  return data.length >= 74 ? nameOf('0x' + data.slice(-40)) : 'another account';
};

export function Vault() {
  const d = getDemo();
  const me = useIdentity()!;
  const who = (me.role ?? 'patient') as Role;
  const addr = d.accounts[who].address;
  const policy = policyFor(who);

  const pol = useAsync(async () => {
    const cm = toHex32(await policyCommitment(policy));
    const p = await c().claims.policies(cm);
    return { used: Number(p.used), active: p.active, cm, matches: p.insurer !== '0x0000000000000000000000000000000000000000' };
  }, [who], 4000);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.names[who]}’s vault`}
        sub="Your records are encrypted on this device and pinned to IPFS as ciphertext. The chain holds only hashes, who you’ve let in, and a log of every look."
        right={
          <div className="text-right text-[12px] text-muted">
            <div className="label">wallet</div>
            <div className="mono">{short(addr, 6)}</div>
          </div>
        }
      />
      <EmergencyBanner addr={addr} />

      <div className="grid md:grid-cols-4 gap-3">
        <Stat label="Plan" value={<span className="text-lg">{policy.planName}</span>} hint={policy.insurerName} />
        <Stat label="Sum insured" value={formatINR(policy.sumInsured)} hint={`deductible ${formatINR(policy.deductible)} · co-pay ${policy.copayBps / 100}%`} />
        <Stat label="Remaining" value={pol.data ? formatINR(policy.sumInsured - pol.data.used) : <Spinner />} tone="mint" hint={pol.data && `used ${formatINR(pol.data.used)} · tracked on-chain`} />
        <Stat
          label="Valid until"
          value={<span className="text-lg">{new Date(policy.endDate * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          hint={policy.waitingUntil * 1000 > Date.now() ? <span className="text-amber">waiting period until {new Date(policy.waitingUntil * 1000).toLocaleDateString('en-IN')}</span> : 'waiting period over'}
        />
      </div>
      <div className="text-[12.5px] text-muted flex flex-wrap gap-2 items-center">
        <Lock size={12} /> On-chain this whole policy is one Poseidon2 commitment {pol.data ? <Hex v={pol.data.cm} n={8} /> : '…'}
        {pol.data?.matches && <Chip tone="mint">recomputed from your copy · found on-chain</Chip>}
        <span>· covers {policy.coveredProcedures.map((p) => PROCEDURES.find((x) => x.code === p)?.display ?? p).join(', ')}</span>
      </div>

      <Identity who={who} />
      <Inbox who={who} />
      <Records who={who} />
      <div className="grid md:grid-cols-2 gap-6">
        <AuditTrail who={who} />
        <Cards who={who} />
      </div>
    </div>
  );
}

function EmergencyBanner({ addr }: { addr: string }) {
  const { data } = useAsync(async () => events('breakGlass', 'EmergencyUnlocked', null, addr), [addr], 4000);
  if (!data?.length) return null;
  const last = data.at(-1);
  return (
    <div className="card border-rose/50 bg-rose/10 p-4 flex items-center gap-3 fade-in">
      <Siren className="text-rose shrink-0" />
      <div className="text-sm">
        <b className="text-rose">Your emergency card was unlocked</b> for {nameOf(last.args.responder)} (block {last.blockNumber}) after 2 of your guardians approved. Every view is in your audit trail.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ identity
function Identity({ who }: { who: Role }) {
  const d = getDemo();
  const { data, reload } = useAsync(() => aadhaarStatus(who), [who], 5000);
  const owner = useAsync(async () => {
    const [a, b] = await Promise.all([aadhaarStatus('patient'), aadhaarStatus('patient2')]);
    return { asha: a.verified, rahul: b.verified };
  }, [who], 5000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<any>(null);
  const [scan, setScan] = useState(false);
  const [stage, setStage] = useState(-1);
  const testQr = useAsync(() => api('/aadhaar/test-qr'), []);
  const isAsha = who === 'patient';
  const ashaTaken = owner.data?.asha;

  async function run(qr: string) {
    setErr('');
    if (testQr.data && qr.trim() !== String(testQr.data.qr).trim()) {
      setErr('That QR isn’t the UIDAI test-mode Aadhaar. This deployment trusts UIDAI’s published test key (production would pin UIDAI’s real key), so only the test card verifies.');
      return;
    }
    setBusy(true);
    try {
      setStage(0);
      trace({ kind: 'id', title: 'Parsed UIDAI secure QR', detail: 'signed bytes + RSA-2048 signature · name, DOB, photo, address stay on this phone', vis: 'private' });
      await new Promise((r) => setTimeout(r, 500));
      setStage(1);
      await new Promise((r) => setTimeout(r, 500));
      setStage(2);
      const r = await verifyAadhaar(who);
      setRes(r);
      setStage(3);
    } catch (e: any) {
      const r = revertReason(e);
      setStage(-1);
      setErr(
        r === 'DuplicateAadhaar'
          ? `Blocked by the contract: DuplicateAadhaar. This Aadhaar already backs ${dupOwner(e)}’s account. One Aadhaar = one Mohar account, so nobody can open a second policy wallet with a borrowed identity.`
          : r === 'AlreadyVerified'
            ? 'Already verified.'
            : r === 'InvalidAadhaarProof'
              ? 'Blocked by the contract: InvalidAadhaarProof — the proof is bound to a different wallet.'
              : r,
      );
    }
    setBusy(false);
    reload();
    owner.reload();
  }

  const stages = ['Read the secure QR on this phone', 'Check UIDAI’s RSA signature inside a Groth16 circuit', 'Verify the proof on-chain (PatientRegistry)', 'Store the nullifier: this Aadhaar is now used up'];

  return (
    <Card
      icon={<Fingerprint size={18} />}
      title="Identity · Anon Aadhaar"
      sub="Prove you hold a genuine UIDAI-signed Aadhaar and are 18+, revealing only your state. One Aadhaar backs exactly one account."
      right={
        data?.verified ? (
          <Chip tone="mint">
            <UserCheck size={12} /> verified · 18+ · {data.state}
          </Chip>
        ) : (
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => setScan(true)}>
              {busy ? <Spinner /> : <ScanLine size={15} />} {isAsha ? 'Scan my Aadhaar QR' : 'Try Asha’s Aadhaar'}
            </button>
          </div>
        )
      }
    >
      {!isAsha && !data?.verified && (
        <div className="rounded-lg border border-amber/40 bg-amber/10 p-3 text-[13px] leading-relaxed mb-3">
          <b>Demo note:</b> UIDAI publishes exactly one test-mode Aadhaar, and it is Asha’s. Rahul has no card of his own here, so this is the{' '}
          <b>“one Aadhaar, two accounts”</b> attack: scan Asha’s card from Rahul’s wallet and watch the contract refuse it.
          {!ashaTaken && <div className="mt-1 text-amber font-semibold">Verify Asha first (sign in as Asha). Otherwise Rahul’s wallet would claim the card and Asha would be the one blocked.</div>}
        </div>
      )}
      <div className="grid sm:grid-cols-4 gap-3 text-[13px]">
        <div>
          <div className="label">Revealed</div>
          <div className="mt-1">age ≥ 18 · state</div>
        </div>
        <div>
          <div className="label">Hidden</div>
          <div className="mt-1 flex gap-1 flex-wrap">
            <Redacted text="Aadhaar no." /> <Redacted text="name" /> <Redacted text="DOB" /> <Redacted text="photo" />
          </div>
        </div>
        <div>
          <div className="label">Proof</div>
          <div className="mt-1">Groth16 over the UIDAI RSA-2048 signature, made on this device at onboarding</div>
        </div>
        <div>
          <div className="label">Mode</div>
          <div className="mt-1">UIDAI test key (demo card)</div>
        </div>
      </div>
      {stage >= 0 && (
        <div className="mt-4 space-y-1.5 fade-in">
          {stages.map((s, i) => (
            <Check key={s} ok={stage > i || (stage === 3 && i === 3) ? true : null}>
              <span className="inline-flex items-center gap-2">
                {s} {stage === i && i < 3 && <Spinner size={11} />}
              </span>
            </Check>
          ))}
        </div>
      )}
      {res && (
        <div className="mt-3 text-[13px] text-mint fade-in">
          Verified on-chain · {res.gas.toLocaleString()} gas · nullifier {String(res.proof.nullifier).slice(0, 12)}…
        </div>
      )}
      {err && <div className="mt-3 text-[13px] text-rose leading-relaxed flex gap-2"><ShieldAlert size={16} className="shrink-0 mt-0.5" /> {err}</div>}
      {isAsha && !data?.verified && testQr.data && (
        <details className="mt-4 text-[12.5px] text-muted">
          <summary className="cursor-pointer hover:text-fg">Need the test card? Show the UIDAI test-mode Aadhaar QR (print it or open it on a phone, then scan)</summary>
          <div className="mt-3 flex gap-4 items-start">
            <QrImage value={testQr.data.qr} size={150} label="UIDAI test-mode Aadhaar (Anon Aadhaar test key)" download="uidai-test-aadhaar.png" />
            <p className="max-w-md leading-relaxed">
              This is the real secure-QR format from mAadhaar / the printed card: a large number encoding signed demographic data and a photo. It is signed with UIDAI’s
              published <i>test</i> key, which this deployment trusts.
            </p>
          </div>
        </details>
      )}
      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Scan Aadhaar secure QR"
        hint={
          <>
            Scan the QR from mAadhaar or the printed card. It’s read on this device only.
            {isAsha ? ' No card to hand? Use the UIDAI test card.' : ' For Rahul: present Asha’s card — the contract should refuse it.'}
          </>
        }
        demo={testQr.data ? { label: isAsha ? 'Use UIDAI test card' : 'Present Asha’s card', value: testQr.data.qr } : undefined}
        onResult={run}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ consent inbox
function Inbox({ who }: { who: Role }) {
  const d = getDemo();
  const { data, reload } = useAsync(async () => {
    const items = await api(`/consent?patient=${d.accounts[who].address}`);
    return Promise.all(items.map(async (i: any) => ({ ...i, open: i.status === 'pending' ? await patientOpenRequest(who, i).catch(() => null) : null })));
  }, [who], 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = (data ?? []).filter((i: any) => i.status === 'pending');
  const signed = (data ?? []).filter((i: any) => i.status === 'signed');
  return (
    <Card
      icon={<FileHeart size={18} />}
      title="Claim consent requests"
      sub="A hospital can’t claim on your policy unless you sign the exact amount and payout address. Your phone re-derives every number from your own policy first."
    >
      {!pending.length && <Empty>No pending requests. {signed.length ? `${signed.length} signed earlier.` : 'A hospital starts one at admission.'}</Empty>}
      <div className="space-y-3">
        {pending.map((i: any) => {
          const o = i.open;
          if (!o) return null;
          const p = o.payload;
          return (
            <div key={i.id} className="rounded-md border border-violet/50 bg-violet/5 p-4 fade-in">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-sm text-muted">{p.hospital} asks you to approve</div>
                  <div className="text-lg font-bold">{p.procedure.display}</div>
                  <div className="text-sm text-muted">
                    Diagnosis {p.diagnosis.code} · {p.diagnosis.display} <span className="text-violet">(only you and the hospital can read this)</span>
                  </div>
                  <div className="mt-2 text-sm">
                    Bill {formatINR(p.bill.reduce((a: number, b: any) => a + b.amount, 0))} → insurer pays <b className="text-mint">{formatINR(p.claim.payoutAmount)}</b> to{' '}
                    {p.claim.rail === 'zcash' ? 'a Zcash shielded address' : 'a one-time address'} <Hex v={p.claim.recipient} />
                  </div>
                </div>
                <div className="space-y-1.5 min-w-60">
                  <Check ok={o.checks.payoutMatchesPolicy}>Payout matches my policy maths</Check>
                  <Check ok={o.checks.covered}>Procedure is on my covered list</Check>
                  <Check ok={o.checks.nullifierMatches}>Claim ID derived from my record</Check>
                  <Check ok={o.checks.digestMatches}>Signing exactly these terms</Check>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(i.id);
                    try {
                      await patientApprove(who, i);
                    } catch (e: any) {
                      alert(revertReason(e));
                    }
                    setBusy(null);
                    reload();
                  }}
                >
                  {busy === i.id ? <Spinner /> : <KeyRound size={15} />} Approve & sign
                </button>
                <button className="btn btn-ghost" onClick={async () => (await api(`/consent/${i.id}`, { decline: true }), reload())}>
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ records
const TARGETS = [
  { id: 'doctor', role: 1, label: 'Dr. Meera Iyer', what: 'full record', types: null as string[] | null, kind: '' },
  { id: 'lab', role: 3, label: 'Raipur Diagnostics Lab', what: 'lab slice: Patient + Observation', types: ['Patient', 'Observation'], kind: 'lab-order' },
  { id: 'pharmacy', role: 4, label: 'Jan Aushadhi Pharmacy', what: 'prescription slice: Patient + MedicationRequest + Allergy', types: ['Patient', 'MedicationRequest', 'AllergyIntolerance'], kind: 'prescription' },
] as const;

function Records({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data, reload } = useAsync(async () => {
    const ids: string[] = await c().vault.recordsOf(addr);
    return Promise.all(
      ids.map(async (id) => {
        const r = await c().vault.records(id);
        const grantees: string[] = await c().vault.granteesOf(id);
        const grants = await Promise.all(grantees.map(async (g) => ({ g, ...(await c().vault.getGrant(id, g)).toObject(), can: await c().vault.canAccess(id, g) })));
        return { id, kind: r.kind as string, cid: r.cid as string, version: Number(r.version), updatedAt: Number(r.updatedAt), grants };
      }),
    );
  }, [who], 5000);
  const [open, setOpen] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('doctor');
  const [hours, setHours] = useState(24);
  const [err, setErr] = useState('');

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setErr('');
    try {
      await fn();
    } catch (e: any) {
      setErr(revertReason(e));
    }
    setBusy(null);
    reload();
  };

  const share = (recordId: string) =>
    act('s' + recordId, async () => {
      const t = TARGETS.find((x) => x.id === target)!;
      const grantee = d.accounts[t.id as Role]?.address;
      if (!grantee) throw new Error(`${t.label} isn’t on this chain — re-run ./scripts/demo.sh`);
      if (t.types) await shareSlice(who, recordId, grantee, t.role, hours, [...t.types], t.kind);
      else await shareRecord(who, recordId, grantee, t.role, hours);
      setShareFor(null);
    });

  const label = (k: string) => ({ 'emergency-card': 'Emergency card', 'lab-order': 'Lab order (slice)', prescription: 'Prescription (slice)', encounter: 'Encounter' } as any)[k] ?? k;

  return (
    <Card
      icon={<FilePlus2 size={18} />}
      title="My records"
      sub="AES-256-GCM ciphertext on IPFS · the key is wrapped separately for each person you share with (ECIES) · revoking re-encrypts the record so old keys die"
    >
      {!data?.length && <Empty>No records yet.</Empty>}
      {err && <div className="text-[13px] text-rose mb-3">Blocked: {err}</div>}
      <div className="space-y-3">
        {(data ?? []).map((r) => (
          <div key={r.id} className="rounded-md border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-semibold">{label(r.kind)}</div>
                  <div className="text-xs text-muted">
                    ipfs://<span className="mono">{r.cid.slice(0, 18)}…</span> · v{r.version}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-ghost" onClick={() => act('o' + r.id, async () => setOpen({ ...open, [r.id]: open[r.id] ? null : await openRecord(who, r.id, 'owner') }))}>
                  {busy === 'o' + r.id ? <Spinner /> : <Eye size={15} />} {open[r.id] ? 'Hide' : 'Decrypt'}
                </button>
                {r.kind !== 'emergency-card' && (
                  <button className="btn btn-ghost" onClick={() => setShareFor(shareFor === r.id ? null : r.id)}>
                    <Share2 size={15} /> Share
                  </button>
                )}
              </div>
            </div>
            {shareFor === r.id && (
              <div className="mt-3 rounded-lg bg-panel2 p-3 fade-in">
                <div className="grid sm:grid-cols-3 gap-2">
                  {TARGETS.filter((t) => !(r.kind !== 'encounter' && t.types)).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTarget(t.id)}
                      className={`text-left rounded-lg border p-2.5 text-[12.5px] ${target === t.id ? 'border-text bg-panel' : 'border-line hover:border-text/40'}`}
                    >
                      <div className="font-semibold">{t.label}</div>
                      <div className="text-muted">{t.what}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-3 items-center flex-wrap">
                  <select className="input w-auto" value={hours} onChange={(e) => setHours(+e.target.value)}>
                    <option value={1}>for 1 hour</option>
                    <option value={24}>for 24 hours</option>
                    <option value={168}>for 7 days</option>
                  </select>
                  <button className="btn btn-primary" onClick={() => share(r.id)} disabled={!!busy}>
                    {busy === 's' + r.id ? <Spinner /> : <Share2 size={15} />} Grant access
                  </button>
                  <span className="text-[12px] text-muted">
                    {TARGETS.find((t) => t.id === target)?.types ? 'Only the slice is re-encrypted and shared; the full record never leaves your phone.' : 'Doctors must be NMC-verified — the contract checks.'}
                  </span>
                </div>
              </div>
            )}
            {r.grants.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.grants.map((g: any) => (
                  <div key={g.g} className="flex items-center gap-2 text-xs border border-line rounded-lg pl-3 pr-1 py-1">
                    <span>{nameOf(g.g)}</span>
                    <Chip tone={g.can ? 'mint' : 'gray'}>
                      {g.can ? `${ROLE_NAMES[Number(g.role)]} · until ${new Date(Number(g.expiresAt) * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'no access'}
                    </Chip>
                    {g.can && Number(g.role) !== 5 && (
                      <button className="btn btn-danger !py-1 !px-2 !text-xs" onClick={() => act('r' + r.id + g.g, () => revokeAndRekey(who, r.id, g.g))}>
                        {busy === 'r' + r.id + g.g ? <Spinner size={11} /> : <Undo2 size={12} />} Revoke + re-key
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {open[r.id] && (
              <div className="mt-3">
                <FhirView bundle={open[r.id]} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ audit trail
function AuditTrail({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data } = useAsync(async () => {
    const ids: string[] = await c().vault.recordsOf(addr);
    const all: any[] = [];
    for (const n of ['RecordRegistered', 'RecordUpdated', 'AccessGranted', 'AccessRevoked', 'AccessLogged']) {
      for (const id of ids) all.push(...(await events('vault', n, id)).map((e) => ({ n, e })));
    }
    for (const n of ['EmergencyRequested', 'EmergencyUnlocked']) all.push(...(await events('breakGlass', n, null, addr)).map((e) => ({ n, e })));
    all.push(...(await events('patients', 'PatientVerified', addr).catch(() => [])).map((e: any) => ({ n: 'PatientVerified', e })));
    return all.sort((a, b) => b.e.blockNumber - a.e.blockNumber || b.e.index - a.e.index).slice(0, 40);
  }, [who], 4000);
  const text = ({ n, e }: any): [any, string, string] => {
    const a = e.args;
    switch (n) {
      case 'RecordRegistered':
        return [FilePlus2, `Record added (${a.kind})`, 'text-muted'];
      case 'RecordUpdated':
        return [KeyRound, `Record re-encrypted → v${a.version} · ${a.reason}`, 'text-violet'];
      case 'AccessGranted':
        return [Share2, `${nameOf(a.grantee)} granted ${ROLE_NAMES[Number(a.role)]} access until ${new Date(Number(a.expiresAt) * 1000).toLocaleString('en-IN')}`, 'text-sky'];
      case 'AccessRevoked':
        return [Undo2, `${nameOf(a.grantee)} access revoked`, 'text-rose'];
      case 'AccessLogged':
        return [Eye, `${nameOf(a.viewer)} viewed a record — “${a.purpose}”`, 'text-amber'];
      case 'EmergencyRequested':
        return [Siren, `${nameOf(a.responder)} requested emergency access: “${a.reason}”`, 'text-rose'];
      case 'EmergencyUnlocked':
        return [ShieldAlert, `Emergency card unlocked for ${nameOf(a.responder)}`, 'text-rose'];
      case 'PatientVerified':
        return [ShieldCheck, 'Identity verified with Anon Aadhaar', 'text-mint'];
    }
    return [Eye, n, 'text-muted'];
  };
  return (
    <Card title="Audit trail" sub="Every grant, revoke, view and change — written on-chain, readable by you forever.">
      {!data?.length && <Empty>Nothing yet.</Empty>}
      <ul className="space-y-2 max-h-80 overflow-auto pr-1">
        {(data ?? []).map((x: any, i: number) => {
          const [I, t, tone] = text(x);
          return (
            <li key={i} className="flex gap-3 text-sm items-start">
              <I size={14} className={`${tone} shrink-0 mt-0.5`} />
              <span className="flex-1">{t}</span>
              <span className="text-xs text-muted mono">#{x.e.blockNumber}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ QR cards
function Cards({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data } = useAsync(async () => c().breakGlass.getSetup(addr), [who]);
  const [tab, setTab] = useState<'card' | 'sos'>('card');
  const card = JSON.stringify({ app: 'kavach', t: 'patient-card', patient: addr, name: d.names[who] });
  const sos = JSON.stringify({ app: 'kavach', t: 'emergency', patient: addr, chain: d.deployment.chainId, breakGlass: d.deployment.breakGlass });
  useEffect(() => {
    if (!data?.active) setTab('card');
  }, [data?.active]);
  return (
    <Card
      title="My QR codes"
      sub="Show these instead of handing over papers. They carry an address, never medical data."
      right={
        <div className="flex gap-1 card p-1 !rounded-lg">
          <button className={`px-2.5 py-1 rounded-md text-[12px] ${tab === 'card' ? 'bg-text text-ink' : 'text-muted'}`} onClick={() => setTab('card')}>
            Mohar card
          </button>
          <button className={`px-2.5 py-1 rounded-md text-[12px] ${tab === 'sos' ? 'bg-text text-ink' : 'text-muted'}`} onClick={() => setTab('sos')}>
            Emergency
          </button>
        </div>
      }
    >
      {tab === 'card' ? (
        <div className="flex gap-5 items-start">
          <QrImage value={card} size={150} label={`Mohar card · ${d.names[who]}`} download={`kavach-card-${who}.png`} />
          <div className="text-[13px] space-y-2">
            <div className="font-semibold">Show at hospital admission</div>
            <p className="text-muted leading-relaxed">The hospital desk scans it to address the encrypted consent request to you. Your diagnosis is never in it.</p>
          </div>
        </div>
      ) : data?.active ? (
        <div className="flex gap-5 items-start">
          <QrImage value={sos} size={150} label={`Emergency · ${d.names[who]}`} download={`kavach-emergency-${who}.png`} />
          <div className="space-y-1.5 text-sm">
            <div className="font-semibold">Lock-screen emergency QR</div>
            <div className="label pt-1">Guardians (any 2 of 3)</div>
            {data.guardians.map((g: string) => (
              <div key={g} className="text-[13px]">
                {nameOf(g)}
              </div>
            ))}
            <p className="text-xs text-muted pt-1">A paramedic scans this. Guardians then release key shares; every step is on-chain.</p>
          </div>
        </div>
      ) : (
        <Empty>No guardians configured for this patient.</Empty>
      )}
    </Card>
  );
}
