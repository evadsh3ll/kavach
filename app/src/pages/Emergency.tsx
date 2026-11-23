import { useState } from 'react';
import { getBytes, hexlify, toUtf8Bytes, keccak256 } from 'ethers';
import { combineShares, openJSON, unwrapKey, wrapKey } from '@kavach/sdk';
import { KeyRound, ScanLine, ShieldAlert, Siren, Unlock } from 'lucide-react';
import { PageHeader } from '../App';
import { Card, Chip, Empty, Field, Spinner, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { QrScanner } from '../components/Qr';
import { c, getDemo, nameOf, revertReason, Role, short } from '../lib/chain';
import { ipfsGet } from '../lib/zk';
import { useIdentity } from '../lib/session';
import { trace } from '../lib/trace';
import { encPriv } from '../lib/wallet';

const dec = (b: string) => JSON.parse(new TextDecoder().decode(getBytes(b)));

async function allRequests() {
  const n = Number(await c().breakGlass.requestCount());
  return Promise.all(
    [...Array(n).keys()].map(async (i) => {
      const r = (await c().breakGlass.requests(i)).toObject();
      return { id: i, ...r, approvers: (await c().breakGlass.approversOf(i)) as string[] };
    }),
  );
}

// ================================================================ paramedic
export function Responder() {
  const d = getDemo();
  const { data, reload } = useAsync(allRequests, [], 3000);
  const [reason, setReason] = useState('Unconscious after road accident on NH-53, suspected internal bleeding');
  const [patient, setPatient] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState('');
  const [cards, setCards] = useState<Record<number, any>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const responder = d.accounts.responder;

  async function act(k: string, fn: () => Promise<any>) {
    setBusy(k);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(revertReason(e));
    }
    setBusy('');
    reload();
  }

  function onScan(t: string) {
    try {
      const j = JSON.parse(t);
      if (j.app !== 'kavach' || !j.patient) throw 0;
      if (j.t && j.t !== 'emergency') return setErr('That’s a Mohar patient card, not the emergency QR. Ask for the lock-screen emergency QR.');
      setPatient(j.patient);
      setErr('');
    } catch {
      setErr('Not a Mohar emergency QR.');
    }
  }

  async function requestAccess() {
    const setup = await c().breakGlass.getSetup(patient!);
    if (!setup.active) throw new Error(`${nameOf(patient!)} has not set up break-glass guardians.`);
    trace({ kind: 'crypto', title: 'Attached this device’s public key', detail: 'guardians will re-wrap their key shares to it, so only this responder can combine them', vis: 'public' });
    await (await c('responder').breakGlass.request(patient!, hexlify(await c().vault.encryptionKey(responder.address)), reason, 'CG-108-AMB-0417')).wait();
  }

  async function openCard(req: any) {
    const shares: { x: number; y: string }[] = [];
    for (const g of req.approvers) {
      const s = dec(await c().breakGlass.responderShares(req.id, g));
      shares.push({ x: s.x, y: hexlify(await unwrapKey(s.w, await encPriv('responder'))) });
    }
    trace({ kind: 'crypto', title: `Unwrapped ${shares.length} key share${shares.length === 1 ? '' : 's'}`, detail: shares.length < 2 ? '1 Shamir share reveals nothing about the key' : 'Shamir 2-of-3 → reconstructing the AES key', vis: 'private' });
    if (shares.length < 2) {
      setMsg({ ...msg, [req.id]: `Holding ${shares.length} of 2 shares. With one Shamir share the key is information-theoretically hidden, so there is nothing to decrypt yet.` });
      return;
    }
    const key = combineShares(shares.slice(0, 2));
    await (await c('responder').breakGlass.logView(req.id)).wait();
    const setup = await c().breakGlass.getSetup(req.patient);
    const rec = await c().vault.records(setup.emergencyRecordId);
    const bytes = await ipfsGet(rec.cid);
    if (keccak256(bytes) !== rec.contentHash) throw new Error('content hash mismatch');
    const card = await openJSON(key, JSON.parse(new TextDecoder().decode(bytes)));
    trace({ kind: 'ok', title: 'Emergency card decrypted', detail: 'only the emergency card — never the full history · view logged on-chain', vis: 'private' });
    setCards({ ...cards, [req.id]: card });
    setMsg({ ...msg, [req.id]: '' });
  }

  const mine = (data ?? []).filter((r) => r.responder.toLowerCase() === responder.address.toLowerCase()).reverse();
  const asha = JSON.stringify({ app: 'kavach', t: 'emergency', patient: d.accounts.patient.address, chain: d.deployment.chainId, breakGlass: d.deployment.breakGlass });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Break-glass · paramedic"
        sub="The patient can’t consent. Scan the emergency QR on her lock screen. Her emergency card’s key is split 2-of-3 among guardians; any two can release it to you, and every step is written on-chain."
      />
      {err && (
        <div className="card border-rose/40 bg-rose/10 p-3 text-[13px] text-rose flex gap-2">
          <ShieldAlert size={16} /> {err}
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title="1 · Identify the patient" icon={<ScanLine size={18} />}>
          {patient ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
              <div>
                <div className="font-semibold">{nameOf(patient)}</div>
                <div className="mono text-[12px] text-muted">{short(patient, 6)}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => setScan(true)}>
                Rescan
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => setScan(true)}>
              <ScanLine size={15} /> Scan emergency QR
            </button>
          )}
          <p className="text-[12.5px] text-muted mt-3">The QR holds only an address and where to ask — no medical data.</p>
        </Card>
        <Card title="2 · Request access" icon={<Siren size={18} />}>
          <Field label="Reason (written on-chain, the patient sees it)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button className="btn btn-primary mt-3" disabled={!patient || !!busy} onClick={() => act('req', requestAccess)}>
            {busy === 'req' ? <Spinner /> : <Siren size={15} />} Request break-glass access
          </button>
        </Card>
      </div>

      <Card title="3 · My requests" sub="Wait for 2 guardians, then rebuild the key on this device.">
        {mine.length === 0 && <Empty>No requests yet.</Empty>}
        <div className="space-y-3">
          {mine.map((r) => (
            <div key={r.id} className="rounded-md border border-line p-4">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <div className="text-sm">
                  Request #{r.id} · <b>{nameOf(r.patient)}</b> · “{r.reason}”
                </div>
                <Chip tone={r.unlocked ? 'mint' : 'amber'}>{r.unlocked ? 'unlocked · 24h' : `${Number(r.approvals)}/2 guardians`}</Chip>
              </div>
              <div className="text-[12px] text-muted mt-1">Approved by: {r.approvers.length ? r.approvers.map((a: string) => nameOf(a)).join(', ') : 'nobody yet'}</div>
              <button className="btn btn-ghost mt-3" onClick={() => act('o' + r.id, () => openCard(r))}>
                {busy === 'o' + r.id ? <Spinner /> : <Unlock size={15} />} Reconstruct key & open card
              </button>
              {msg[r.id] && <div className="text-sm text-amber mt-2">{msg[r.id]}</div>}
              {cards[r.id] && (
                <div className="mt-3">
                  <FhirView bundle={cards[r.id]} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Scan the patient’s emergency QR"
        hint="Point the camera at the Emergency QR (Patient → My QR codes → Emergency, or a printed / downloaded PNG on a phone)."
        demo={{ label: 'Demo: Asha’s lock screen', value: asha }}
        onResult={onScan}
      />
    </div>
  );
}

// ================================================================ guardian
export function GuardianPage() {
  const d = getDemo();
  const id = useIdentity()!;
  const g = id.role as Role;
  const me = d.accounts[g].address;
  const { data, reload } = useAsync(allRequests, [], 3000);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function approve(req: any) {
    setBusy('a' + req.id);
    setErr('');
    try {
      const setup = await c().breakGlass.getSetup(req.patient);
      const idx = setup.guardians.findIndex((x: string) => x.toLowerCase() === me.toLowerCase());
      if (idx < 0) throw new Error('You are not a guardian for this patient.');
      const mine = dec(setup.wrappedShares[idx]);
      const share = await unwrapKey(mine.w, await encPriv(g)); // only this guardian can do this
      trace({ kind: 'crypto', title: 'Unwrapped my key share', detail: 'share stored on-chain encrypted to this guardian only', vis: 'private' });
      const forResponder = await wrapKey(share, hexlify(req.responderPubKey));
      trace({ kind: 'crypto', title: 'Re-wrapped share to the responder', detail: `ECIES to ${nameOf(req.responder)}’s key`, vis: 'sealed' });
      await (await c(g).breakGlass.approve(req.id, toUtf8Bytes(JSON.stringify({ x: mine.x, w: forResponder })))).wait();
    } catch (e) {
      setErr(revertReason(e));
    }
    setBusy('');
    reload();
  }

  const reqs = (data ?? []).slice().reverse();
  return (
    <div className="space-y-6">
      <PageHeader title={id.name} sub="You hold 1 of 3 Shamir shares of Asha’s emergency-card key. One share alone reveals nothing. Two guardians together unlock it for a responder." />
      {err && <div className="card border-rose/40 bg-rose/10 p-3 text-[13px] text-rose">{err}</div>}
      <Card title="Emergency requests" icon={<KeyRound size={18} />}>
        {reqs.length === 0 && <Empty>No emergency requests. (A paramedic starts one by scanning the patient’s QR.)</Empty>}
        <div className="space-y-3">
          {reqs.map((r) => {
            const did = r.approvers.map((a: string) => a.toLowerCase()).includes(me.toLowerCase());
            return (
              <div key={r.id} className="rounded-md border border-line p-4 flex justify-between items-center gap-3 flex-wrap">
                <div className="text-sm">
                  <b>{nameOf(r.responder)}</b> wants {nameOf(r.patient)}’s emergency card
                  <div className="text-muted text-xs mt-0.5">
                    “{r.reason}” · {r.responderId} · {Number(r.approvals)}/2 approvals
                  </div>
                </div>
                {did ? (
                  <Chip tone="mint">you released your share</Chip>
                ) : r.unlocked ? (
                  <Chip tone="gray">already unlocked</Chip>
                ) : (
                  <button className="btn btn-primary" onClick={() => approve(r)} disabled={!!busy}>
                    {busy === 'a' + r.id ? <Spinner /> : <KeyRound size={15} />} Release my share
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <p className="text-[12.5px] text-muted">
        Other guardians: {(['guardian1', 'guardian2', 'guardian3'] as Role[]).filter((x) => x !== g).map((x) => d.names[x]).join(' · ')} — switch role from the menu at the top right.
      </p>
    </div>
  );
}
