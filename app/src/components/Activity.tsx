import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Boxes, CircleCheck, CircleX, Cpu, Database, Fingerprint, Globe, KeyRound, Lock, Send, ShieldCheck } from 'lucide-react';
import { onTrace, TraceEvent } from '../lib/trace';
import { txUrl } from '../lib/wallet';

const ICON: Record<string, any> = { crypto: KeyRound, ipfs: Database, chain: Boxes, zk: Cpu, net: Send, id: Fingerprint, ok: CircleCheck, fail: CircleX };
const TONE: Record<string, string> = {
  crypto: 'text-violet',
  ipfs: 'text-sky',
  chain: 'text-sky',
  zk: 'text-text',
  net: 'text-amber',
  id: 'text-mint',
  ok: 'text-mint',
  fail: 'text-rose',
};

export function useTrace() {
  const [ev, setEv] = useState<TraceEvent[]>([]);
  useEffect(() => {
    const off = onTrace(setEv);
    return () => void off();
  }, []);
  return ev;
}

export function VisChip({ vis }: { vis?: TraceEvent['vis'] }) {
  if (!vis) return null;
  if (vis === 'private')
    return (
      <span className="chip bg-violet/10 text-violet !text-[10px] !py-0">
        <Lock size={9} /> stays on device
      </span>
    );
  if (vis === 'sealed')
    return (
      <span className="chip bg-amber/12 text-amber !text-[10px] !py-0">
        <ShieldCheck size={9} /> leaves encrypted
      </span>
    );
  return (
    <span className="chip bg-sky/10 text-sky !text-[10px] !py-0">
      <Globe size={9} /> public
    </span>
  );
}

/** Live log of real operations. `since` hides events older than a marker (e.g. the current story step). */
export function ActivityLog({ since = 0, until = Infinity, compact = false, empty = 'Nothing yet — run a step.', max }: { since?: number; until?: number; compact?: boolean; empty?: string; max?: number }) {
  const all = useTrace();
  const ev = all.filter((e) => e.id > since && e.id <= until).slice(max ? -max : undefined);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [ev.length]);
  if (!ev.length) return <div className="text-[12px] text-muted py-3 text-center">{empty}</div>;
  return (
    <ol className="space-y-1.5">
      {ev.map((e) => {
        const I = ICON[e.kind] ?? Cpu;
        return (
          <li key={e.id} className="flex gap-2.5 fade-in">
            <I size={compact ? 13 : 14} className={`${TONE[e.kind]} shrink-0 mt-[3px]`} />
            <div className="min-w-0 flex-1">
              <div className={`flex items-center gap-1.5 flex-wrap ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
                <span className="font-medium">{e.title}</span>
                <VisChip vis={e.vis} />
                <span className="text-[10px] text-muted">{e.where}</span>
              </div>
              {e.detail && <div className={`text-muted ${compact ? 'text-[11px]' : 'text-[11.5px]'} leading-snug break-words`}>{e.detail}</div>}
              {(e.tx || e.wire) && (
                <div className="mono text-[10.5px] text-muted flex gap-3 flex-wrap mt-0.5">
                  {e.wire && (
                    <span className="text-amber inline-flex items-center gap-1">
                      <ArrowUpRight size={10} /> {e.wire}
                    </span>
                  )}
                  {e.tx &&
                    (txUrl(e.tx) ? (
                      <a className="text-sky underline underline-offset-2" href={txUrl(e.tx)!} target="_blank" rel="noreferrer">
                        tx {e.tx.slice(0, 10)}…
                      </a>
                    ) : (
                      <span className="text-sky">tx {e.tx.slice(0, 10)}…</span>
                    ))}
                  {e.block != null && <span>block #{e.block}</span>}
                  {!!e.gas && <span>{e.gas.toLocaleString()} gas</span>}
                </div>
              )}
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
