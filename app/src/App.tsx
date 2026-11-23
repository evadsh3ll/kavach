import { ReactNode, useEffect, useState } from 'react';
import { ChevronDown, Cpu, ExternalLink, FlaskConical, ListChecks, LogOut, PanelRightClose, PanelRightOpen, Play, QrCode, ScanEye, Users } from 'lucide-react';
import { Story } from './pages/Story';
import { Vault } from './pages/Vault';
import { Seal } from './pages/Seal';
import { Provider } from './pages/Doctor';
import { BlindDesk } from './pages/BlindDesk';
import { RegulatorPage } from './pages/Regulator';
import { Responder, GuardianPage } from './pages/Emergency';
import { AttackLab } from './pages/AttackLab';
import { XRay } from './pages/XRay';
import { Login, appBase, roleUrl, useLan } from './pages/Login';
import { ActivityLog, useTrace } from './components/Activity';
import { DemoGuide } from './components/DemoGuide';
import { QrImage } from './components/Qr';
import { identities, Identity, KIND_META, Kind, setIdentity, signIn, useIdentity } from './lib/session';
import { getDemo, short } from './lib/chain';
import { setForceDemo, walletMode } from './lib/wallet';

const ROLE_PAGES: Record<string, Kind[]> = {
  vault: ['patient'],
  seal: ['hospital'],
  desk: ['insurer'],
  provider: ['doctor', 'lab', 'pharmacy'],
  regulator: ['regulator'],
  responder: ['responder'],
  guardian: ['guardian'],
};
const ALIASES: Record<string, string> = { doctor: 'provider', emergency: 'responder', roles: 'login' };
const SECURITY = [
  { id: 'attack', label: 'Attack Lab', icon: FlaskConical },
  { id: 'xray', label: 'X-Ray', icon: ScanEye },
] as const;
const ALL = ['story', 'login', ...Object.keys(ROLE_PAGES), 'attack', 'xray'];
const pageFromHash = (): string => {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const p = ALIASES[h] ?? h;
  return ALL.includes(p) ? p : 'story';
};


export function App() {
  const [page, setPage] = useState<string>(pageFromHash());
  const me = useIdentity();
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem('kavach.panel') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const f = () => setPage(pageFromHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (p: string) => (location.hash = '/' + p);
  // presenter screens run hands-free on built-in keys, even if this tab signed in with MetaMask
  setForceDemo(['story', 'attack', 'xray'].includes(page));
  const isRolePage = page in ROLE_PAGES;
  const group = page === 'story' ? 'story' : SECURITY.some((s) => s.id === page) ? 'security' : 'live';
  const lab = group === 'security';
  const togglePanel = () => {
    setPanel(!panel);
    try {
      localStorage.setItem('kavach.panel', panel ? '0' : '1');
    } catch {}
  };

  // Role guard: a role screen needs a signed-in identity of the right kind.
  let body: ReactNode;
  if (page === 'story') body = <Story go={go} />;
  else if (page === 'login' || (isRolePage && !me)) body = <Login go={go} />;
  else if (isRolePage && me && !ROLE_PAGES[page].includes(me.kind)) body = <WrongRole me={me} page={page} go={go} />;
  else
    body = (
      <>
        {page === 'vault' && <Vault />}
        {page === 'seal' && <Seal />}
        {page === 'provider' && <Provider />}
        {page === 'desk' && <BlindDesk />}
        {page === 'regulator' && <RegulatorPage />}
        {page === 'responder' && <Responder />}
        {page === 'guardian' && <GuardianPage />}
        {page === 'attack' && <AttackLab />}
        {page === 'xray' && <XRay />}
      </>
    );

  const showPanel = group === 'live' && panel;

  return (
    <div className={`min-h-screen ${lab ? 'lab' : ''}`}>
      <header className="sticky top-0 z-40 h-[52px] border-b border-line bg-ink flex items-center px-6 gap-8">
        <button onClick={() => go('story')} className="flex items-center gap-2 shrink-0">
          <Logo size={22} />
          <span className="text-[16px] font-semibold tracking-[-0.02em]">Mohar</span>
        </button>
        <nav className="flex items-center gap-6 h-full text-[14px]">
          <Tab on={group === 'story'} onClick={() => go('story')}>
            Story
          </Tab>
          <Tab on={group === 'live'} onClick={() => go(me ? me.page : 'login')}>
            Live demo
          </Tab>
          <Tab on={group === 'security'} onClick={() => go(lab ? page : 'attack')}>
            Security
          </Tab>
          {group === 'security' && (
            <span className="flex items-center gap-4 text-[13px] text-muted pl-6 border-l border-line h-5">
              {SECURITY.map((r) => (
                <button key={r.id} onClick={() => go(r.id)} className={page === r.id ? 'text-text font-medium' : 'hover:text-text'}>
                  {r.label}
                </button>
              ))}
            </span>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-5 text-[13px]">
          {group === 'live' && (
            <button className="text-muted hover:text-text" onClick={togglePanel}>
              {panel ? 'Hide guide' : 'Show guide'}
            </button>
          )}
          {me ? (
            <RoleChip me={me} go={go} />
          ) : group === 'live' ? null : (
            <button className="text-muted hover:text-text" onClick={() => go('login')}>
              Sign in
            </button>
          )}
        </div>
      </header>
      {page === 'story' ? (
        body
      ) : (
        <div className="flex">
          <main className="flex-1 min-w-0 px-6 md:px-12 py-10">
            <div className="max-w-6xl mx-auto">{body}</div>
          </main>
          {showPanel && <SidePanel go={go} />}
        </div>
      )}
    </div>
  );
}

function SidePanel({ go }: { go: (p: string) => void }) {
  const [tab, setTab] = useState<'guide' | 'hood'>('guide');
  const ev = useTrace();
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (tab === 'hood') setSeen(ev.length);
  }, [tab, ev.length]);
  const unread = tab === 'guide' ? ev.length - seen : 0;
  return (
    <aside className="w-[320px] shrink-0 border-l border-line sticky top-[52px] h-[calc(100vh-52px)] flex flex-col">
      <div className="flex gap-5 px-5 h-11 items-end border-b border-line text-[13px]">
        <Tab on={tab === 'guide'} onClick={() => setTab('guide')}>
          Demo guide
        </Tab>
        <Tab on={tab === 'hood'} onClick={() => setTab('hood')}>
          Under the hood{unread > 0 && <span className="ml-1.5 text-muted">{unread}</span>}
        </Tab>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        {tab === 'guide' ? (
          <>
            <p className="text-[12.5px] text-muted mb-3 leading-snug">The whole workflow. Each step is ticked from the live chain and says which role to sign in as.</p>
            <DemoGuide go={go} />
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-muted mb-4 leading-snug">Every real operation in this tab, and whether its data stays on the device, leaves encrypted, or is public.</p>
            <ActivityLog empty="Do something in this role and it shows up here." />
          </>
        )}
      </div>
    </aside>
  );
}

function RoleChip({ me, go }: { me: Identity; go: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState(false);
  const lan = useLan();
  const m = KIND_META[me.kind];
  const d = getDemo();
  const addr = me.role ? d.accounts[me.role]?.address : null;
  const quick = identities().filter((i) => ['patient', 'hospital-1', 'insurer', 'doctor', 'lab', 'pharmacy', 'regulator', 'responder', 'guardian1', 'guardian2', 'patient2'].includes(i.id));
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 hover:text-text">
        <span className="text-muted">{m.label}</span>
        <span className="font-medium max-w-[220px] truncate">{me.name}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-3 z-50 card p-2 w-[300px] shadow-[0_12px_32px_-12px_rgba(20,21,23,.25)]">
            <div className="px-2 py-1.5 text-[11.5px] text-muted">
              Signed in with {walletMode() === 'metamask' ? 'MetaMask' : 'a demo wallet'}{addr ? <> · <span className="mono">{short(addr, 4)}</span></> : ' · hospital staff key'}
            </div>
            <div className="flex gap-1 px-1 pb-2 border-b border-line">
              <button className="btn btn-ghost !py-1 !px-2 !text-[12px] flex-1 justify-center" onClick={() => (setQr(true), setOpen(false))}>
                <QrCode size={13} /> On phone
              </button>
              <a className="btn btn-ghost !py-1 !px-2 !text-[12px] flex-1 justify-center" href={roleUrl(location.origin, me)} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> New window
              </a>
              <button
                className="btn btn-ghost !py-1 !px-2 !text-[12px]"
                title="Sign out"
                onClick={() => {
                  setIdentity(null);
                  setOpen(false);
                  go('login');
                }}
              >
                <LogOut size={13} />
              </button>
            </div>
            <div className="label px-2 pt-2 pb-1">Switch role</div>
            <div className="max-h-[50vh] overflow-auto">
              {quick.map((i) => (
                <button
                  key={i.id}
                  className={`w-full text-left px-2 py-1.5 rounded-lg hover:bg-panel2 flex items-center gap-2 text-[12.5px] ${i.id === me.id ? 'bg-panel2' : ''}`}
                  onClick={async () => {
                    setOpen(false);
                    await signIn(i);
                    go(i.page);
                  }}
                >
                  <span className="font-medium truncate">{i.name}</span>
                  <span className="ml-auto text-[10.5px] text-muted">{KIND_META[i.kind].label}</span>
                </button>
              ))}
              <button className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-panel2 text-[12.5px] text-muted" onClick={() => (setOpen(false), go('login'))}>
                All roles…
              </button>
            </div>
          </div>
        </>
      )}
      {qr && (
        <div className="fixed inset-0 z-50 bg-text/50 grid place-items-center p-4" onClick={() => setQr(false)}>
          <div className="card p-6 text-center w-[380px]" onClick={(e) => e.stopPropagation()}>
            <div className="serif text-[24px]">Open as {me.name}</div>
            <div className="mt-3">
              <QrImage value={roleUrl(appBase(lan), me)} size={220} label={me.name} />
            </div>
            <div className="mono text-[11px] text-muted mt-2 break-all">{roleUrl(appBase(lan), me)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function WrongRole({ me, page, go }: { me: Identity; page: string; go: (p: string) => void }) {
  const want = ROLE_PAGES[page];
  const options = identities().filter((i) => want.includes(i.kind));
  return (
    <div className="max-w-xl mx-auto card p-6 mt-10 text-center">
      <div className="serif text-[28px]">This screen belongs to the {want.map((k) => KIND_META[k].label).join(' / ')}</div>
      <p className="text-muted mt-2 text-[14px]">
        You’re signed in as <b>{me.name}</b> ({KIND_META[me.kind].label}). Each role only sees its own app — that’s the point.
      </p>
      <div className="flex flex-wrap gap-2 justify-center mt-5">
        <button className="btn btn-ghost" onClick={() => go(me.page)}>
          Back to my screen
        </button>
        {options.slice(0, 3).map((i) => (
          <button key={i.id} className="btn btn-primary" onClick={async () => (await signIn(i), go(i.page))}>
            Sign in as {i.name.split(' (')[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`h-full flex items-center border-b-2 -mb-px transition-colors ${on ? 'border-text text-text font-medium' : 'border-transparent text-muted hover:text-text'}`}>
      {children}
    </button>
  );
}

/** Mohar mark: a wax seal (scalloped) with a redaction bar across it — proven, but sealed. */
export function Logo({ size = 30 }: { size?: number }) {
  let d = '';
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const r = 46 + 3.4 * Math.cos(a * 14);
    d += `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d={d + 'Z'} fill="var(--color-text)" />
      <circle cx="50" cy="50" r="34" fill="none" stroke="#c9a227" strokeWidth="3" />
      <rect x="22" y="43" width="56" height="14" rx="3" fill="var(--color-ink)" />
    </svg>
  );
}

export function PageHeader({ title, sub, right }: { icon?: ReactNode; title: string; sub: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-8 mb-10 flex-wrap">
      <div>
        <h1 className="text-[30px] font-semibold tracking-[-0.025em] leading-[1.1]">{title}</h1>
        <p className="text-muted mt-2 max-w-2xl text-[15px] leading-relaxed">{sub}</p>
      </div>
      {right}
    </header>
  );
}
