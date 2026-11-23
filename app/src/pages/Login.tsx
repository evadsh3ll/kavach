import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, KeyRound, QrCode, ScanLine, Smartphone } from 'lucide-react';
import { getDemo, short } from '../lib/chain';
import { addressOf, identities, identityFor, Identity, KIND_META, Kind, signIn } from '../lib/session';
import { connectMetaMask, ensureChain, hasMetaMask, metaMaskAccounts, networkParams, onAccountsChanged } from '../lib/wallet';
import { revertReason } from '../lib/chain';
import { api } from '../lib/zk';
import { QrImage, QrScanner } from '../components/Qr';
import { Spinner } from '../components/ui';

const GROUPS: { title: string; kinds: Kind[]; note: string }[] = [
  { title: 'The claim', kinds: ['patient', 'hospital', 'insurer'], note: 'Patient → Hospital → Insurer' },
  { title: 'Care team', kinds: ['doctor', 'lab', 'pharmacy'], note: 'See only what a patient shares, while it lasts' },
  { title: 'Oversight and emergencies', kinds: ['regulator', 'responder', 'guardian'], note: 'Licensing, and break-glass access' },
];

export function appBase(lan: string | null) {
  const { protocol, port, hostname } = location;
  if (lan && (hostname === 'localhost' || hostname === '127.0.0.1')) return `${protocol}//${lan}${port ? ':' + port : ''}`;
  return location.origin;
}

export function useLan() {
  const [lan, setLan] = useState<string | null>(null);
  useEffect(() => {
    api('/lan')
      .then((r) => setLan(r.publicUrl ? null : r.ips?.[0] ?? null))
      .catch(() => {});
  }, []);
  return lan;
}

export const roleUrl = (base: string, i: Identity) => `${base}/?as=${i.id}#/${i.page}`;

export function Login({ go }: { go: (p: string) => void }) {
  const d = getDemo();
  const all = identities();
  const [busy, setBusy] = useState('');
  const [qrFor, setQrFor] = useState<Identity | null>(null);
  const [scan, setScan] = useState(false);
  const lan = useLan();
  const base = appBase(lan);

  async function enter(i: Identity) {
    setBusy(i.id);
    try {
      await signIn(i, 'demo');
      go(i.page);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-10">
        <div>
          <h1 className="text-[30px] font-semibold tracking-[-0.025em] leading-[1.1]">Sign in</h1>
          <p className="text-muted mt-2 max-w-2xl text-[15px] leading-relaxed">
            Every party is a real wallet on the chain. Signing in signs a one-time challenge with it, and each browser tab keeps its own role, so you can open
            the patient, hospital and insurer side by side.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setScan(true)}>
          <ScanLine size={15} /> Scan a sign-in QR
        </button>
      </div>

      <MetaMaskPanel go={go} />

      <div className="flex items-baseline justify-between gap-4 mt-14 mb-2">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Or use a built-in demo wallet</h2>
        <span className="text-[13px] text-muted">No pop-ups — for a quick look, a phone, or Story mode</span>
      </div>
      <div className="space-y-10">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="flex items-baseline justify-between gap-4 pb-2 border-b border-text/80">
              <h2 className="font-semibold text-[15px]">{g.title}</h2>
              <span className="text-[13px] text-muted hidden md:block">{g.note}</span>
            </div>
            <div>
              {all
                .filter((i) => g.kinds.includes(i.kind))
                .map((i) => {
                  const m = KIND_META[i.kind];
                  const addr = i.role ? d.accounts[i.role]?.address : null;
                  return (
                    <div key={i.id} className="grid grid-cols-[110px_1fr_auto] md:grid-cols-[110px_1.3fr_1fr_auto] items-center gap-4 py-3 border-b border-line group">
                      <span className="text-[13px] text-muted">{m.label}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-[14.5px] truncate">{i.name}</div>
                        <div className="text-[12.5px] text-muted truncate">{i.sub}</div>
                      </div>
                      <span className="mono text-[12px] text-muted hidden md:block">{addr ? short(addr, 4) : 'no on-chain wallet'}</span>
                      <div className="flex items-center gap-1">
                        <button className="p-2 text-muted hover:text-text" title="Open on a phone" onClick={() => setQrFor(i)}>
                          <QrCode size={15} />
                        </button>
                        <a className="p-2 text-muted hover:text-text" title="Open in a new window" href={roleUrl(location.origin, i)} target="_blank" rel="noreferrer">
                          <ExternalLink size={15} />
                        </a>
                        <button className="btn btn-ghost !py-1 ml-1" onClick={() => enter(i)} disabled={!!busy}>
                          {busy === i.id ? <Spinner size={13} /> : null} Sign in
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      {qrFor && (
        <div className="fixed inset-0 z-50 bg-text/50 grid place-items-center p-4" onClick={() => setQrFor(null)}>
          <div className="card p-6 w-[420px] max-w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-[20px] font-semibold tracking-[-0.02em]">Open as {qrFor.name}</div>
            <p className="text-[13px] text-muted mt-1">Scan with a phone on the same Wi-Fi. It signs in straight into this role.</p>
            <div className="mt-4">
              <QrImage value={roleUrl(base, qrFor)} size={220} label={`${KIND_META[qrFor.kind].label} · ${qrFor.name}`} />
            </div>
            <div className="mono text-[11px] text-muted mt-3 break-all">{roleUrl(base, qrFor)}</div>
            {location.protocol === 'http:' && (
              <p className="text-[11.5px] text-amber mt-3 leading-snug">
                Phones need HTTPS for WebCrypto and the camera: start with <span className="mono">HTTPS=1 ./scripts/demo.sh</span> and accept the self-signed certificate.
              </p>
            )}
          </div>
        </div>
      )}

      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Scan a sign-in QR"
        hint="Point the camera at a role’s QR (the QR icon on any card) — e.g. from another laptop or a printed badge."
        onResult={(t) => {
          const m = /[?&]as=([\w-]+)/.exec(t);
          const i = m && all.find((x) => x.id === m[1]);
          if (i) enter(i);
          else alert('Not a Mohar sign-in QR.');
        }}
      />
    </div>
  );
}

function MetaMaskPanel({ go }: { go: (p: string) => void }) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const net = networkParams();
  useEffect(() => {
    metaMaskAccounts().then(setAccounts).catch(() => {});
    return onAccountsChanged((a) => setAccounts(a));
  }, []);

  async function connect() {
    setErr('');
    setBusy('connect');
    try {
      if (accounts.length) {
        await (window as any).ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
        setAccounts(await metaMaskAccounts());
      } else setAccounts(await connectMetaMask());
    } catch (e) {
      setErr(revertReason(e));
    }
    setBusy('');
  }
  async function enter(i: Identity) {
    setErr('');
    setBusy(i.id);
    try {
      await ensureChain();
      await signIn(i, 'metamask');
      go(i.page);
    } catch (e) {
      setErr(revertReason(e));
    }
    setBusy('');
  }

  const rows = accounts.map((a) => ({ a, i: identityFor(a) }));
  return (
    <section className="border-t border-text/80 pt-5">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="max-w-2xl">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Sign in with MetaMask</h2>
          <p className="text-[14px] text-muted mt-1.5 leading-relaxed">
            Import the role wallets into MetaMask (<span className="mono text-[12.5px]">ROLE-WALLETS.local.md</span>, written by <span className="mono text-[12.5px]">./scripts/demo.sh</span>), connect
            them here, and every transaction and signature appears in MetaMask. Connect several accounts and each tab can act as a different role.
          </p>
        </div>
        {hasMetaMask() && (
          <button className="btn btn-primary" onClick={connect} disabled={!!busy}>
            {busy === 'connect' ? <Spinner size={13} /> : null} {accounts.length ? 'Choose accounts' : 'Connect MetaMask'}
          </button>
        )}
      </div>

      <div className="mt-4 text-[13px] text-muted flex flex-wrap items-center gap-x-5 gap-y-1">
        <span>
          Network <span className="text-text">{net.chainName}</span>
        </span>
        <span>
          Chain ID <span className="mono text-text">{net._id}</span>
        </span>
        <span>
          RPC <span className="mono text-text">{net.rpcUrls[0]}</span>
        </span>
        {hasMetaMask() && (
          <button className="underline underline-offset-2 hover:text-text" onClick={() => ensureChain().catch((e) => setErr(revertReason(e)))}>
            Add / switch network
          </button>
        )}
      </div>

      {!hasMetaMask() && <p className="mt-4 text-[14px]">MetaMask isn’t installed in this browser. Install the extension, or use a built-in demo wallet below.</p>}

      {rows.length > 0 && (
        <div className="mt-5">
          {rows.map(({ a, i }) => (
            <div key={a} className="grid grid-cols-[110px_1fr_auto] md:grid-cols-[110px_1.3fr_1fr_auto] items-center gap-4 py-3 border-b border-line">
              <span className="text-[13px] text-muted">{i ? KIND_META[i.kind].label : 'Unknown'}</span>
              <div className="min-w-0">
                <div className="font-medium text-[14.5px] truncate">{i ? i.name : 'Not a Mohar role wallet'}</div>
                <div className="text-[12.5px] text-muted truncate">{i ? i.sub : 'Import a key from ROLE-WALLETS.local.md'}</div>
              </div>
              <span className="mono text-[12px] text-muted hidden md:block">{short(a, 4)}</span>
              {i ? (
                <button className="btn btn-primary !py-1" onClick={() => enter(i)} disabled={!!busy}>
                  {busy === i.id ? <Spinner size={13} /> : null} Sign in
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-3 text-[13.5px] text-rose">{err}</p>}
    </section>
  );
}
