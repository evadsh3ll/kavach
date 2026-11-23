import { ArrowRight, Check as CheckIcon } from 'lucide-react';
import { c, events, getDemo } from '../lib/chain';
import { api } from '../lib/zk';
import { aadhaarStatus } from '../lib/flow';
import { getIdentity, identities, KIND_META, signIn } from '../lib/session';
import { useAsync } from './ui';

type G = { id: string; who: string; text: string; hint: string; group: string };
const GUIDE: G[] = [
  { id: 'aadhaar', who: 'patient', group: 'Claim', text: 'Verify identity with Anon Aadhaar', hint: 'Patient → Identity card → Verify' },
  { id: 'seal', who: 'hospital-1', group: 'Claim', text: 'Scan Asha’s card, seal the encounter, ask consent', hint: 'Hospital → Scan patient card → Seal record & request consent' },
  { id: 'sign', who: 'patient', group: 'Claim', text: 'Check the numbers & sign consent', hint: 'Patient → Consent requests → Approve & sign' },
  { id: 'settle', who: 'hospital-1', group: 'Claim', text: 'Prove in-browser & settle via relayer', hint: 'Hospital → Generate proof & submit' },
  { id: 'insurer', who: 'insurer', group: 'Claim', text: 'See the blind claim: amount + proof only', hint: 'Insurer → Settled claims' },
  { id: 'share', who: 'patient', group: 'Records', text: 'Share a record (doctor / lab / pharmacy)', hint: 'Patient → My records → Share' },
  { id: 'open', who: 'doctor', group: 'Records', text: 'Open it — the view is logged on-chain first', hint: 'Doctor → Open (logged)' },
  { id: 'revoke', who: 'patient', group: 'Records', text: 'Revoke + re-key: old key dies', hint: 'Patient → Revoke + re-key' },
  { id: 'scan', who: 'responder', group: 'Emergency', text: 'Scan Asha’s emergency QR, request break-glass', hint: 'Paramedic → Scan emergency QR' },
  { id: 'approve', who: 'guardian1', group: 'Emergency', text: '2 of 3 guardians release their key shares', hint: 'Guardian → Release my share (do 2 guardians)' },
  { id: 'unlock', who: 'responder', group: 'Emergency', text: 'Rebuild the key, open the emergency card', hint: 'Paramedic → Reconstruct key & open card' },
];

async function progress() {
  const d = getDemo();
  const asha = d.accounts.patient.address;
  const [aad, inbox, settled, grants, logs, revokes, reqs, unlocked, views] = await Promise.all([
    aadhaarStatus('patient'),
    api(`/consent?patient=${asha}`),
    c().claims.claimsSettled(),
    events('vault', 'AccessGranted'),
    events('vault', 'AccessLogged'),
    events('vault', 'AccessRevoked'),
    c().breakGlass.requestCount(),
    events('breakGlass', 'EmergencyUnlocked'),
    events('breakGlass', 'EmergencyViewed').catch(() => []),
  ]);
  const shared = grants.filter((g: any) => Number(g.args.role) !== 5);
  const seen = (() => {
    try {
      return localStorage.getItem('kavach.insurerSeen') === '1';
    } catch {
      return false;
    }
  })();
  return {
    aadhaar: aad.verified,
    seal: (inbox ?? []).length > 0,
    sign: (inbox ?? []).some((i: any) => i.status === 'signed'),
    settle: Number(settled) > 0,
    insurer: Number(settled) > 0 && seen,
    share: shared.length > 0,
    open: logs.some((l: any) => l.args.viewer.toLowerCase() !== asha.toLowerCase()),
    revoke: revokes.length > 0,
    scan: Number(reqs) > 0,
    approve: unlocked.length > 0,
    unlock: views.length > 0,
  } as Record<string, boolean>;
}

export function DemoGuide({ go }: { go: (p: string) => void }) {
  const { data } = useAsync(progress, [], 2500);
  const me = getIdentity();
  const all = identities();
  const next = GUIDE.find((g) => !data?.[g.id]);
  let group = '';
  return (
    <ol className="space-y-0.5">
      {GUIDE.map((g, i) => {
        const done = !!data?.[g.id];
        const isNext = next?.id === g.id;
        const who = all.find((x) => x.id === g.who)!;
        const meta = KIND_META[who.kind];
        const header = g.group !== group ? ((group = g.group), g.group) : null;
        const here = me?.kind === who.kind;
        return (
          <li key={g.id}>
            {header && <div className="label mt-3 mb-1.5 first:mt-0">{header}</div>}
            <div className={`rounded-md px-2 py-2 flex gap-2.5 items-start ${isNext ? 'bg-panel2' : ''}`}>
              <span
                className={`mt-0.5 w-5 h-5 shrink-0 rounded-full grid place-items-center text-[10px] font-semibold border ${
                  done ? 'bg-mint/15 text-mint border-mint/30' : isNext ? 'bg-text text-ink border-text' : 'text-muted border-line'
                }`}
              >
                {done ? <CheckIcon size={11} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[12.5px] leading-snug ${done ? 'text-muted line-through decoration-text/20' : isNext ? 'font-semibold' : ''}`}>{g.text}</div>
                <div className="text-[11px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  {isNext && <span className="text-muted">{g.hint.split('→').slice(1).join('→')}</span>}
                </div>
                {isNext && !here && (
                  <button
                    className="mt-1.5 btn btn-primary !py-1 !px-2.5 !text-[12px]"
                    onClick={async () => {
                      await signIn(who);
                      go(who.page);
                    }}
                  >
                    Sign in as {meta.label.toLowerCase()} <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
