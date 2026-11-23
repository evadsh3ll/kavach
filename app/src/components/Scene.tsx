// The visual stage for Story mode: what judges see. No logs, no hex — objects moving between people.
// Three rooms: Asha's phone and the hospital are PRIVATE (violet, dashed), the blockchain is PUBLIC (teal).
// Only the wax "mohar" seal ever crosses into public. Every animation is driven by the real step results.
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Clock3, CloudUpload, Eye, FileText, Globe, Lock, Newspaper, ScanSearch, ShieldX, TriangleAlert, Wallet } from 'lucide-react';
import { formatINR } from '@kavach/sdk';
import type { ScanRow } from '../lib/leakscan';

export type Phase = 'idle' | 'run' | 'done';
export interface SceneProps {
  step: string;
  order: string[];
  phase: Phase;
  done: Record<string, boolean>;
  s: any;
  payout: number;
  bill: number;
  policy: any;
  commitment: string;
}

const W = 1280;
const H = 520;
const INK = '#16181d';
const VIOLET = '#141517'; // private = ink
const TEAL = '#4b5560'; // public = slate
const GREEN = '#12704f';
const RED = '#b8322a';
const GOLD = '#c9a227';
const ease = [0.65, 0, 0.35, 1] as const;

// ------------------------------------------------------------------ stage (fixed canvas, scaled to fit)
function Stage({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => setK(Math.min(el.clientWidth / W, el.clientHeight / H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="w-full h-full relative overflow-hidden">
      <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, transform: `translate(-50%,-50%) scale(${k})` }}>
        {children}
      </div>
    </div>
  );
}

const At = ({ x, y, children, className = '', style }: { x: number; y: number; children: ReactNode; className?: string; style?: any }) => (
  <div className={`absolute ${className}`} style={{ left: x, top: y, ...style }}>
    {children}
  </div>
);

/** An object travelling from a → b (pixel coords of its top-left). */
function Fly({ from, to, delay = 0, dur = 1.1, children, stay = true, k }: { from: [number, number]; to: [number, number]; delay?: number; dur?: number; children: ReactNode; stay?: boolean; k?: string }) {
  return (
    <motion.div
      key={k}
      className="absolute left-0 top-0 z-30"
      initial={{ x: from[0], y: from[1], opacity: 0, scale: 0.7 }}
      animate={{ x: [from[0], (from[0] + to[0]) / 2, to[0]], y: [from[1], Math.min(from[1], to[1]) - 70, to[1]], opacity: stay ? [0, 1, 1] : [0, 1, 0], scale: [0.7, 1.05, 1] }}
      transition={{ duration: dur, delay, ease, times: [0, 0.5, 1] }}
    >
      {children}
    </motion.div>
  );
}

const Caption = ({ children, tone = 'muted', w = 160 }: { children: ReactNode; tone?: 'muted' | 'violet' | 'teal' | 'green' | 'red'; w?: number }) => (
  <div
    className="text-[12px] leading-snug text-center mx-auto"
    style={{ width: w, color: tone === 'violet' ? VIOLET : tone === 'teal' ? TEAL : tone === 'green' ? GREEN : tone === 'red' ? RED : '#5b5e66' }}
  >
    {children}
  </div>
);

// ------------------------------------------------------------------ illustrations
function Person({ coat, size = 64, hair = INK, scarf }: { coat: string; size?: number; hair?: string; scarf?: string }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 64 74" aria-hidden>
      <path d="M8 74 C8 54 20 46 32 46 C44 46 56 54 56 74 Z" fill={coat} />
      {scarf && <path d="M22 48 C28 56 36 56 42 48 L40 58 C35 62 29 62 24 58 Z" fill={scarf} />}
      <circle cx="32" cy="26" r="15" fill="#e8cdb0" />
      <path d="M17 25 C17 12 47 10 47 25 C44 18 24 17 17 25 Z" fill={hair} />
    </svg>
  );
}

function scallop(cx: number, cy: number, r: number, n = 18, amp = 3.2) {
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const rr = r + amp * Math.cos(a * n);
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}

/** The mohar: a wax seal that says "this claim is valid" and nothing else. */
export function Seal({ amount, size = 112, label = 'VALID' }: { amount: string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden className="drop-shadow-[0_10px_18px_rgba(22,24,29,.35)]">
      <path d={scallop(60, 60, 52)} fill={INK} />
      <circle cx="60" cy="60" r="43" fill="none" stroke={GOLD} strokeWidth="2" />
      <circle cx="60" cy="60" r="38" fill="none" stroke={GOLD} strokeWidth="0.8" strokeDasharray="2 3" />
      <text x="60" y="47" textAnchor="middle" fontSize="9" letterSpacing="2.5" fill={GOLD} fontFamily="IBM Plex Sans, sans-serif" fontWeight="700">
        {label}
      </text>
      <text x="60" y="68" textAnchor="middle" fontSize="17" fill="#fff" fontFamily="IBM Plex Sans, sans-serif" fontWeight="600">
        {amount}
      </text>
      <path d="M50 79 l7 7 l14 -14" fill="none" stroke="#43c27d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Coin({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <circle cx="15" cy="15" r="14" fill="#e9c349" stroke="#a8841c" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="10" fill="none" stroke="#a8841c" strokeWidth="0.8" />
      <text x="15" y="20" textAnchor="middle" fontSize="13" fill="#7a5c0e" fontWeight="700">
        ₹
      </text>
    </svg>
  );
}

/** A paper medical file. `locked` turns it into violet ciphertext. */
function MedFile({ locked, w = 132, rows }: { locked?: boolean; w?: number; rows: [string, string][] }) {
  return (
    <motion.div
      className="rounded-lg border bg-white shadow-[0_10px_24px_-12px_rgba(22,24,29,.4)] p-2.5 relative overflow-hidden"
      style={{ width: w, borderColor: locked ? VIOLET : '#ddd8cc' }}
      animate={{ backgroundColor: locked ? '#e8e8e4' : '#ffffff' }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: locked ? VIOLET : '#5b5e66' }}>
        <FileText size={11} /> Medical file
      </div>
      <div className="mt-1.5 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="text-[10.5px] leading-tight">
            <div className="text-[#8a8d95]">{k}</div>
            <motion.div className="font-semibold text-[11.5px]" animate={{ filter: locked ? 'blur(3.5px)' : 'blur(0px)', color: locked ? VIOLET : INK }} transition={{ duration: 0.5 }}>
              {v}
            </motion.div>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {locked && (
          <motion.div
            className="absolute inset-0 grid place-items-center"
            initial={{ scale: 2.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
          >
            <div className="w-10 h-10 rounded-full grid place-items-center text-white shadow-lg" style={{ background: VIOLET }}>
              <Lock size={19} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Envelope({ text }: { text: string }) {
  return (
    <div className="relative w-[78px] h-[52px]">
      <svg width="78" height="52" viewBox="0 0 78 52" aria-hidden>
        <rect x="1" y="1" width="76" height="50" rx="5" fill="#fff" stroke={VIOLET} strokeWidth="1.5" />
        <path d="M2 4 L39 30 L76 4" fill="none" stroke={VIOLET} strokeWidth="1.5" />
        <circle cx="39" cy="30" r="7" fill={VIOLET} />
      </svg>
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold" style={{ color: VIOLET }}>
        {text}
      </div>
    </div>
  );
}

function Zone({ x, w, title, tone, sub }: { x: number; w: number; title: string; tone: 'private' | 'public'; sub: string }) {
  const c = tone === 'private' ? VIOLET : TEAL;
  return (
    <div
      className="absolute rounded-[22px]"
      style={{
        left: x,
        top: 34,
        width: w,
        height: H - 44,
        border: tone === 'public' ? '1px solid #d6d6d1' : '1px dashed #c9c9c4',
        background: tone === 'public' ? '#fcfcfb' : '#efefec',
      }}
    >
      <div className="absolute -top-[26px] left-2 flex items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-[#16181d]">{title}</span>
        <span className="chip !py-0.5" style={{ background: '#14151710', color: c }}>
          {tone === 'private' ? <Lock size={10} /> : <Globe size={10} />} {sub}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the scene
export function Scene(p: SceneProps) {
  if (p.step === 'problem') return <Stage><Today /></Stage>;
  return (
    <Stage>
      <World {...p} />
    </Stage>
  );
}

const PH = { x: 32, y: 92, w: 168, h: 330 }; // phone
const FILE: [number, number] = [262, 118];
const PRESS = { x: 452, y: 112 };
const CONTRACT = { x: 650, y: 52, w: 250, h: 150 };
const SLOT: [number, number] = [CONTRACT.x + 174, CONTRACT.y + 52];
const LEDGER = { x: 650, y: 222, w: 250, h: 270 };
const STORE = { x: 925, y: 52, w: 160, h: 112 };
const INS = { x: 1108, y: 170 };
const POOL = { x: 1100, y: 404 };
const GHOST = { x: 925, y: 392, w: 160, h: 98 };

function World(p: SceneProps) {
  const idx = (id: string) => p.order.indexOf(id);
  const cur = idx(p.step);
  const reached = (id: string) => cur > idx(id) || (cur === idx(id) && p.phase === 'done');
  const running = (id: string) => p.step === id && p.phase === 'run';
  const here = (id: string) => p.step === id;
  const amt = formatINR(p.payout);
  const s = p.s;
  const proofKB = s.proof ? (s.proof.proof.length / 1024).toFixed(1) : '8.6';
  const proofS = s.proof ? (s.proof.proveMs / 1000).toFixed(1) : null;

  const fileRows: [string, string][] = [
    ['Patient', 'Asha Verma'],
    ['Diagnosis', 'Breast cancer'],
    ['Treatment', 'Chemotherapy'],
    ['Bill', formatINR(p.bill)],
  ];

  // ledger rows — everything that is actually public
  const ledger: { k: string; label: string; v: string; tone?: string }[] = [];
  ledger.push({ k: 'pol', label: 'Policy fingerprint', v: p.commitment.slice(0, 10) + '…' });
  if (reached('identity') || s.identity) ledger.push({ k: 'id', label: 'A verified adult (18+), Delhi', v: 'Aadhaar number hidden' });
  if (reached('consent')) ledger.push({ k: 'rec', label: 'Record fingerprint', v: 'file stays encrypted' });
  if (reached('settle')) ledger.push({ k: 'claim', label: `Valid claim · ${amt} paid`, v: 'to a one-time wallet', tone: GREEN });

  const hospitalBusy = ['admit', 'prove', 'settle'].includes(p.step);
  const phoneBusy = ['intro', 'identity', 'consent'].includes(p.step);
  const insurerBusy = ['insurer', 'leak', 'end'].includes(p.step);

  return (
    <div className="absolute inset-0">
      <Zone x={14} w={204} title="Asha’s phone" tone="private" sub="only Asha" />
      <Zone x={232} w={392} title="Balco Medical Centre" tone="private" sub="only the hospital" />
      <Zone x={638} w={628} title="Public blockchain" tone="public" sub="anyone in the world can read this" />

      {/* ============ PHONE ============ */}
      <motion.div className="absolute" style={{ left: PH.x, top: PH.y }} animate={{ opacity: phoneBusy || here('settle') ? 1 : 0.8, scale: phoneBusy ? 1.02 : 1 }}>
        <div className="rounded-[30px] border-[5px] border-[#16181d] bg-[#fffdf8] overflow-hidden shadow-[0_22px_44px_-22px_rgba(22,24,29,.6)]" style={{ width: PH.w, height: PH.h }}>
          <div className="h-5 flex justify-center">
            <span className="w-16 h-3.5 rounded-b-lg bg-[#16181d]" />
          </div>
          <div className="px-2.5 pt-1 space-y-2">
            <div className="flex items-center gap-2">
              <Person coat="#4b5560" scarf="#c9a227" size={30} />
              <div className="leading-tight">
                <div className="text-[12px] font-semibold">Asha Verma</div>
                <div className="text-[9.5px] text-[#5b5e66]">her vault</div>
              </div>
            </div>
            <PhoneScreen {...p} amt={amt} reached={reached} running={running} />
          </div>
        </div>
      </motion.div>

      {/* ============ HOSPITAL ============ */}
      <At x={248} y={430}>
        <div className="flex items-end gap-2">
          <Person coat="#6f6a60" size={46} />
          <div className="text-[11.5px] text-[#5b5e66] pb-1 leading-tight">
            Billing desk
            <br />
            <span className="text-[10.5px]">writes the file, makes the proof</span>
          </div>
        </div>
      </At>
      <HospitalStage {...p} amt={amt} fileRows={fileRows} reached={reached} running={running} proofKB={proofKB} proofS={proofS} />

      {/* ============ PUBLIC: contract ============ */}
      <motion.div
        className="absolute card p-3"
        style={{ left: CONTRACT.x, top: CONTRACT.y, width: CONTRACT.w, height: CONTRACT.h, borderColor: here('settle') ? TEAL : undefined }}
        animate={{ boxShadow: running('settle') ? `0 0 0 6px ${TEAL}22` : '0 0 0 0px transparent' }}
      >
        <div className="text-[11px] font-semibold" style={{ color: TEAL }}>
          Insurance contract
        </div>
        <div className="text-[11px] text-[#5b5e66] leading-tight w-[150px]">checks every seal, then pays — no human in the loop</div>
        <div className="mt-2 space-y-[3px] w-[150px]">
          {['Seal is genuine', 'Never used before', 'Hospital is licensed', 'Within the policy'].map((t, i) => (
            <motion.div
              key={t}
              className="flex items-center gap-1.5 text-[11px]"
              initial={false}
              animate={{ opacity: reached('settle') ? 1 : 0.35 }}
              transition={{ delay: reached('settle') && here('settle') ? 1.2 + i * 0.25 : 0 }}
            >
              <span className="w-3.5 h-3.5 rounded-full grid place-items-center shrink-0" style={{ background: reached('settle') ? GREEN + '22' : '#16181d10', color: GREEN }}>
                {reached('settle') && <Check size={9} strokeWidth={3} />}
              </span>
              {t}
            </motion.div>
          ))}
        </div>
        {/* seal slot */}
        <div className="absolute rounded-full grid place-items-center" style={{ left: SLOT[0] - CONTRACT.x - 4, top: SLOT[1] - CONTRACT.y - 4, width: 70, height: 70, border: `1.5px dashed ${TEAL}66` }}>
          {!reached('settle') && <span className="text-[9.5px] text-center leading-tight" style={{ color: TEAL }}>seal<br />goes here</span>}
        </div>
        {reached('settle') && !here('settle') && (
          <div className="absolute" style={{ left: SLOT[0] - CONTRACT.x, top: SLOT[1] - CONTRACT.y }}>
            <Seal amount={amt} size={62} />
          </div>
        )}
      </motion.div>

      {/* ledger */}
      <div className="absolute" style={{ left: LEDGER.x, top: LEDGER.y, width: LEDGER.w }}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-1.5" style={{ color: TEAL }}>
          <Globe size={11} /> Public ledger
        </div>
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {ledger.map((r) => (
              <motion.div
                key={r.k}
                layout
                initial={{ opacity: 0, x: -16, backgroundColor: '#fff5c2' }}
                animate={{ opacity: 1, x: 0, backgroundColor: '#fffdf8' }}
                transition={{ duration: 0.6, delay: r.k === 'claim' && here('settle') ? 1.4 : 0.15 }}
                className="rounded-lg border border-[#ddd8cc] px-2.5 py-1.5"
              >
                <div className="text-[11.5px] font-semibold leading-tight" style={{ color: r.tone ?? INK }}>
                  {r.label}
                </div>
                <div className="text-[10.5px] text-[#5b5e66] mono">{r.v}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* storage */}
      <div className="absolute card p-2.5" style={{ left: STORE.x, top: STORE.y, width: STORE.w, height: STORE.h }}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: TEAL }}>
          <CloudUpload size={12} /> File storage
        </div>
        <div className="text-[10.5px] text-[#5b5e66] leading-tight">anyone can download · nobody can read</div>
        <div className="flex gap-1.5 mt-2">
          {['#d8d2c4', '#d8d2c4'].map((c, i) => (
            <span key={i} className="w-6 h-7 rounded" style={{ background: c }} />
          ))}
          {reached('admit') && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: here('admit') ? 1.3 : 0 }} className="w-6 h-7 rounded grid place-items-center text-white" style={{ background: VIOLET }}>
              <Lock size={11} />
            </motion.span>
          )}
        </div>
      </div>

      {/* insurer */}
      <motion.div className="absolute" style={{ left: INS.x, top: INS.y }} animate={{ opacity: insurerBusy || here('settle') ? 1 : 0.8 }}>
        <div className="w-[150px]">
          <div className="flex justify-center">
            <Person coat={INK} size={54} />
          </div>
          <div className="card px-2 py-1.5 mt-1 text-center">
            <div className="text-[11.5px] font-semibold">Suraksha Insurance</div>
            <div className="text-[10.5px] text-[#5b5e66] leading-tight">reads only the public side</div>
          </div>
          {reached('settle') && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: here('settle') ? 2.6 : 0 }} className="mt-2 rounded-lg border border-[#ddd8cc] bg-white p-2 text-[11px]">
              <div className="flex justify-between">
                <b>{amt}</b> <span style={{ color: GREEN }}>valid ✓</span>
              </div>
              <div className="flex gap-1 mt-1 items-center text-[#8a8d95]">
                why? <span className="redact px-1 text-[9px]">████████</span>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* pool + one-time wallet */}
      <div className="absolute" style={{ left: POOL.x, top: POOL.y, width: 160 }}>
        <div className="flex -space-x-2 justify-center">
          {[0, 1, 2, 3, 4].map((i) => (
            <Coin key={i} />
          ))}
        </div>
        <Caption w={160}>Insurer’s claim pool</Caption>
      </div>
      <AnimatePresence>
        {reached('settle') && (
          <motion.div
            className="absolute rounded-xl p-2.5"
            style={{ left: GHOST.x, top: GHOST.y, width: GHOST.w, height: GHOST.h, border: `1.5px dashed ${INK}66`, background: '#fffdf8' }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: here('settle') ? 1.6 : 0 }}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Wallet size={12} /> One-time wallet
            </div>
            <div className="text-[10.5px] text-[#5b5e66] leading-tight">no name on it · only the hospital can open it</div>
            <div className="serif text-[20px] mt-0.5" style={{ color: GREEN }}>
              {amt}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {here('settle') && reached('settle') &&
        [0, 1, 2, 3, 4].map((i) => (
          <Fly key={'coin' + i} from={[POOL.x + 40 + i * 14, POOL.y]} to={[GHOST.x + 100 + (i % 3) * 8, GHOST.y + 50]} delay={2 + i * 0.18} dur={0.9} stay={false}>
            <Coin size={22} />
          </Fly>
        ))}

      {/* ============ step-specific overlays ============ */}
      {/* intro: policy fingerprint flies to the ledger */}
      {here('intro') && (
        <Fly k="pol" from={[PH.x + 40, PH.y + 120]} to={[LEDGER.x + 10, LEDGER.y + 22]} delay={0.6} dur={1.4} stay={false}>
          <div className="chip bg-white border border-[#ddd8cc] shadow">
            <Lock size={10} /> policy fingerprint
          </div>
        </Fly>
      )}
      {/* identity: only "18+ · Delhi" leaves the phone */}
      {here('identity') && reached('identity') && (
        <Fly k="age" from={[PH.x + 30, PH.y + 200]} to={[LEDGER.x + 10, LEDGER.y + 70]} dur={1.3} stay={false}>
          <div className="chip shadow" style={{ background: GREEN, color: '#fff' }}>
            18+ · Delhi ✓
          </div>
        </Fly>
      )}
      {/* admit: locked copy → storage, sealed request → phone */}
      {here('admit') && reached('admit') && (
        <>
          <Fly k="tostore" from={[FILE[0] + 30, FILE[1] + 30]} to={[STORE.x + 70, STORE.y + 60]} delay={0.5} dur={1.1} stay={false}>
            <div className="w-8 h-10 rounded grid place-items-center text-white shadow-lg" style={{ background: VIOLET }}>
              <Lock size={14} />
            </div>
          </Fly>
          <Fly k="env" from={[FILE[0], FILE[1] + 60]} to={[PH.x + 46, PH.y + 120]} delay={1.1} dur={1.3} stay={false}>
            <Envelope text="sealed to Asha" />
          </Fly>
        </>
      )}
      {/* consent: signature back to hospital */}
      {here('consent') && reached('consent') && (
        <Fly k="sig" from={[PH.x + 40, PH.y + 250]} to={[FILE[0] + 10, FILE[1] + 262]} delay={0.9} dur={1.2}>
          <SigChip />
        </Fly>
      )}
      {/* settle: the seal crosses into public */}
      {here('settle') && (
        <motion.div
          className="absolute left-0 top-0 z-30"
          initial={{ x: PRESS.x + 26, y: PRESS.y + 250, scale: 1 }}
          animate={
            p.phase === 'idle'
              ? { x: PRESS.x + 26, y: PRESS.y + 250 }
              : { x: [PRESS.x + 26, 610, SLOT[0]], y: [PRESS.y + 250, 120, SLOT[1]], scale: [1, 1.15, 62 / 112] }
          }
          transition={{ duration: 1.3, ease }}
          style={{ transformOrigin: 'top left' }}
        >
          <Seal amount={amt} />
        </motion.div>
      )}
      {here('settle') && p.phase !== 'idle' && <BoundaryFlash x={631} text="only the seal crosses" />}

      {/* insurer zoom */}
      <AnimatePresence>{here('insurer') && <InsurerLens amt={amt} />}</AnimatePresence>
      {/* leak scan */}
      {here('leak') && <LeakSweep phase={p.phase} rows={s.scan?.rows ?? []} total={s.scan?.txCount} />}
      {/* fraud attempt */}
      {here('end') && <Fraud amt={amt} nul={s.proved?.claim?.nullifier} />}
    </div>
  );
}

function SigChip() {
  return (
    <div className="rounded-lg bg-white border border-[#ddd8cc] shadow px-2 py-1 flex items-center gap-1.5">
      <svg width="46" height="18" viewBox="0 0 46 18" aria-hidden>
        <path d="M2 13 C8 2 10 16 15 8 S22 4 24 11 S32 15 36 6 L44 9" fill="none" stroke={VIOLET} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-[10.5px] font-semibold" style={{ color: VIOLET }}>
        Asha’s OK
      </span>
    </div>
  );
}

function BoundaryFlash({ x, text }: { x: number; text: string }) {
  return (
    <motion.div className="absolute z-20" style={{ left: x - 2, top: 34, height: H - 44 }} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0.0] }} transition={{ duration: 2.2, times: [0, 0.2, 0.7, 1] }}>
      <div className="w-[4px] h-full rounded-full" style={{ background: GOLD, boxShadow: `0 0 18px ${GOLD}` }} />
      <div className="absolute top-[46%] -translate-x-1/2 left-0 whitespace-nowrap chip text-white" style={{ background: INK }}>
        {text}
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ phone screens
function PhoneScreen(p: SceneProps & { amt: string; reached: (id: string) => boolean; running: (id: string) => boolean }) {
  const st = p.step;
  const card = (
    <div className="rounded-xl p-2.5 text-white" style={{ background: INK }}>
      <div className="text-[8.5px] opacity-70">Suraksha Health</div>
      <div className="serif text-[15px] leading-tight">{p.policy.planName}</div>
      <div className="flex justify-between mt-1 mono text-[10.5px]">
        <span>{formatINR(p.policy.sumInsured)}</span>
        <span className="opacity-70">covered</span>
      </div>
    </div>
  );
  if (st === 'intro')
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        {card}
        <div className="text-[10.5px] leading-snug text-[#5b5e66]">Full policy terms live here, on her phone. The chain only keeps a fingerprint.</div>
      </motion.div>
    );
  if (st === 'identity') {
    const red = p.reached('identity') || p.running('identity');
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-[#ddd8cc] bg-white p-2 text-[10.5px]">
          <div className="text-[9px] font-semibold text-[#8a8d95]">Aadhaar</div>
          {[
            ['Name', 'Asha Verma'],
            ['Number', '4821 7730 1166'],
            ['Born', '14 Mar 1991'],
            ['Photo', '▣▣▣'],
          ].map(([k, v], i) => (
            <div key={k} className="flex justify-between items-center mt-0.5">
              <span className="text-[#8a8d95]">{k}</span>
              <span className="relative">
                <span>{v}</span>
                <motion.span className="absolute inset-0 rounded-sm" style={{ background: INK, transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: red ? 1 : 0 }} transition={{ delay: 0.2 + i * 0.2, duration: 0.35 }} />
              </span>
            </div>
          ))}
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-[#8a8d95]">Age · State</span>
            <span className="font-semibold" style={{ color: red ? GREEN : INK }}>
              18+ · Delhi
            </span>
          </div>
        </div>
        <div className="text-[10.5px] leading-snug" style={{ color: p.reached('identity') ? GREEN : '#5b5e66' }}>
          {p.reached('identity') ? 'Proved she’s a real adult. Nothing else left the phone.' : p.running('identity') ? 'Blacking out everything but age & state…' : 'Proves she’s a real person — without showing who.'}
        </div>
      </div>
    );
  }
  if (st === 'admit')
    return (
      <div className="space-y-2">
        {card}
        {p.reached('admit') ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.3 }} className="rounded-lg border p-2 text-[10.5px]" style={{ borderColor: VIOLET, background: VIOLET + '0d' }}>
            <b style={{ color: VIOLET }}>1 new request</b> from Balco hospital. Only this phone can open it.
          </motion.div>
        ) : (
          <div className="text-[10.5px] text-[#5b5e66]">Admitted for chemotherapy…</div>
        )}
      </div>
    );
  if (st === 'consent') {
    const o = p.s.open;
    return (
      <div className="rounded-xl border p-2 text-[10.5px] space-y-1" style={{ borderColor: VIOLET }}>
        <div className="text-[#5b5e66]">Balco hospital asks:</div>
        <div className="font-semibold text-[12px]">
          Pay {p.amt} for chemotherapy?
        </div>
        {[
          ['Amount matches my policy', o?.checks?.payoutMatchesPolicy ?? true],
          ['Treatment is covered', o?.checks?.covered ?? true],
          ['It’s my real hospital visit', o?.checks?.nullifierMatches ?? true],
        ].map(([t, ok]) => (
          <div key={String(t)} className="flex items-center gap-1">
            <Check size={10} strokeWidth={3} style={{ color: ok ? GREEN : RED }} /> {t}
          </div>
        ))}
        <div className="rounded-lg mt-1.5 py-1.5 text-center font-semibold" style={{ background: p.reached('consent') ? GREEN + '1f' : INK, color: p.reached('consent') ? GREEN : '#fff' }}>
          {p.reached('consent') ? (
            <span className="inline-flex items-center gap-1">
              <svg width="40" height="14" viewBox="0 0 46 18" aria-hidden>
                <motion.path d="M2 13 C8 2 10 16 15 8 S22 4 24 11 S32 15 36 6 L44 9" fill="none" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" initial={{ pathLength: 0 } as any} animate={{ pathLength: 1 } as any} transition={{ duration: 0.8 }} />
              </svg>
              Signed
            </span>
          ) : p.running('consent') ? (
            'Signing…'
          ) : (
            'Approve'
          )}
        </div>
      </div>
    );
  }
  // prove / settle / later
  const paid = p.reached('settle');
  return (
    <div className="space-y-2">
      {card}
      <motion.div
        className="rounded-lg border p-2 text-[10.5px]"
        animate={{ borderColor: paid ? GREEN : '#ddd8cc', backgroundColor: paid ? GREEN + '12' : '#ffffff' }}
        transition={{ delay: paid && p.step === 'settle' ? 2.4 : 0 }}
      >
        {paid ? (
          <>
            <b style={{ color: GREEN }}>Claim paid · {p.amt}</b>
            <div className="text-[#5b5e66]">Nothing to pay at discharge. No one at the insurer saw her diagnosis.</div>
          </>
        ) : (
          <span className="text-[#5b5e66]">Waiting for the hospital’s proof…</span>
        )}
      </motion.div>
    </div>
  );
}

// ------------------------------------------------------------------ hospital
function HospitalStage(p: SceneProps & { amt: string; fileRows: [string, string][]; reached: (id: string) => boolean; running: (id: string) => boolean; proofKB: string; proofS: string | null }) {
  const st = p.step;
  const cur = p.order.indexOf(st);
  const at = (id: string) => cur >= p.order.indexOf(id);
  const locked = p.reached('admit') || p.running('admit') || cur > p.order.indexOf('admit');
  const intoPress = at('prove') && !(st === 'prove' && p.phase === 'idle');
  const pressing = p.running('prove');
  const sealed = p.reached('prove');
  const stage = p.s.stage as string | undefined;
  const lit = sealed ? 7 : !pressing ? 0 : stage === 'tree' ? 1 : stage === 'witness' ? 3 : stage === 'prove' ? 6 : 0;
  const checks = ['Hospital is licensed', 'Policy is active', 'Treatment is covered', 'Amount within limit', 'First claim for this visit', 'Asha said yes', 'Money can’t be redirected'];

  return (
    <>
      {/* the file */}
      {at('admit') && (
        <motion.div
          className="absolute z-10"
          initial={{ x: FILE[0], y: FILE[1] + 30, opacity: 0 }}
          animate={intoPress ? { x: PRESS.x + 8, y: PRESS.y + 60, opacity: sealed ? 0 : 1, scale: 0.55 } : { x: FILE[0], y: FILE[1], opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease }}
          style={{ left: 0, top: 0, transformOrigin: 'top left' }}
        >
          <MedFile locked={locked} rows={p.fileRows} />
          {!intoPress && (
            <div className="mt-2 w-[132px]">
              <Caption tone={locked ? 'violet' : 'muted'} w={132}>
                {locked ? 'Locked. Only Asha and the hospital hold the key.' : 'Written by the hospital'}
              </Caption>
            </div>
          )}
        </motion.div>
      )}
      {!at('admit') && (
        <At x={FILE[0]} y={FILE[1] + 40}>
          <div className="w-[132px] h-[150px] rounded-lg border border-dashed border-[#ddd8cc] grid place-items-center text-[11px] text-[#8a8d95] text-center px-3">
            Asha arrives for chemotherapy
          </div>
        </At>
      )}
      {/* signature on the desk */}
      {(p.reached('consent') || at('prove')) && !intoPress && st !== 'consent' && (
        <At x={FILE[0] + 10} y={FILE[1] + 262}>
          <SigChip />
        </At>
      )}

      {/* the press */}
      <div className="absolute" style={{ left: PRESS.x, top: PRESS.y }}>
        <div className="relative w-[150px] h-[230px]">
          <svg width="150" height="230" viewBox="0 0 150 230" aria-hidden className="absolute inset-0">
            <rect x="10" y="200" width="130" height="18" rx="4" fill={INK} />
            <rect x="20" y="20" width="14" height="182" rx="3" fill="#2b303a" />
            <rect x="116" y="20" width="14" height="182" rx="3" fill="#2b303a" />
            <rect x="14" y="10" width="122" height="20" rx="5" fill={INK} />
            <rect x="35" y="150" width="80" height="50" rx="6" fill="#e8e8e4" stroke={VIOLET} strokeDasharray="3 3" />
          </svg>
          <motion.div
            className="absolute left-[40px] w-[70px]"
            animate={pressing ? { y: [36, 104, 36] } : sealed && st === 'prove' ? { y: [36, 110, 36] } : { y: 36 }}
            transition={pressing ? { duration: 0.9, repeat: Infinity, ease } : { duration: 0.6 }}
          >
            <div className="w-[70px] h-[14px] mx-auto bg-[#2b303a] rounded-t" />
            <div className="w-[70px] h-[34px] rounded-b-lg grid place-items-center" style={{ background: GOLD }}>
              <span className="serif text-[13px] font-semibold text-[#16181d]">mohar</span>
            </div>
          </motion.div>
          <div className="absolute -bottom-7 -left-[20px] w-[190px]">
            <Caption w={190}>{sealed ? `Proof made in ${p.proofS ?? '~5'} s · ${p.proofKB} KB` : pressing ? 'Checking 7 rules in secret…' : 'Proof press · runs on this computer'}</Caption>
          </div>
        </div>
      </div>

      {/* 7 rules — light up while proving */}
      {at('prove') && (
        <div className="absolute" style={{ left: 248, top: 96, width: 196 }}>
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: VIOLET }}>
            The seal proves
          </div>
          <div className="space-y-1">
            {checks.map((t, i) => (
              <motion.div key={t} className="flex items-center gap-1.5 text-[11.5px] rounded-md px-1.5 py-[3px]" animate={{ backgroundColor: i < lit ? GREEN + '14' : '#00000000', opacity: i < lit ? 1 : 0.45 }} transition={{ delay: sealed && st === 'prove' ? i * 0.12 : 0 }}>
                <span className="w-4 h-4 rounded-full grid place-items-center shrink-0" style={{ background: i < lit ? GREEN : '#16181d14', color: '#fff' }}>
                  {i < lit && <Check size={10} strokeWidth={3} />}
                </span>
                {t}
              </motion.div>
            ))}
          </div>
          <div className="mt-2 text-[11px] leading-snug" style={{ color: VIOLET }}>
            …without writing down <b>what</b> the illness is.
          </div>
        </div>
      )}

      {/* the seal pops out */}
      <AnimatePresence>
        {sealed && st === 'prove' && (
          <motion.div className="absolute z-20" style={{ left: PRESS.x + 26, top: PRESS.y + 250 }} initial={{ y: -90, scale: 0.3, opacity: 0, rotate: -20 }} animate={{ y: 0, scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 0.35, ease: [0.2, 0, 0, 1], delay: 0.5 }}>
            <Seal amount={p.amt} />
          </motion.div>
        )}
      </AnimatePresence>
      {sealed && st === 'prove' && (
        <At x={PRESS.x + 140} y={PRESS.y + 270}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="w-[120px] text-[11.5px] leading-snug">
            <b>The mohar.</b> Says “valid, {p.amt}”. Nothing else.
          </motion.div>
        </At>
      )}
    </>
  );
}

// ------------------------------------------------------------------ insurer lens
function InsurerLens({ amt }: { amt: string }) {
  const rows: [string, string][] = [
    ['Patient', 'Asha Verma'],
    ['Hospital', 'Balco Medical Centre'],
    ['Diagnosis', 'Breast cancer'],
    ['Treatment', 'Chemotherapy'],
    ['Bill', '₹87,000 itemised'],
  ];
  return (
    <motion.div className="absolute z-40 inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-[#16181d]/25" />
      <motion.div
        className="absolute card p-5 shadow-2xl"
        style={{ left: 640, top: 40, width: 470 }}
        initial={{ scale: 0.6, x: 300, y: 120, opacity: 0 }}
        animate={{ scale: 1, x: 0, y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      >
        <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: TEAL }}>
          <Eye size={14} /> What the insurer can see
        </div>
        <div className="flex items-baseline justify-between mt-2">
          <div className="serif text-[46px] leading-none">{amt}</div>
          <span className="chip text-white" style={{ background: GREEN }}>
            paid automatically
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1 mt-3 text-[12.5px]">
          {['Licensed hospital', 'Active policy', 'Covered treatment', 'Within the limit', 'Not a duplicate', 'Patient agreed'].map((t, i) => (
            <motion.div key={t} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.1 }} className="flex items-center gap-1.5">
              <Check size={13} strokeWidth={3} style={{ color: GREEN }} /> {t}
            </motion.div>
          ))}
        </div>
        <div className="perforated mt-4 pt-3 space-y-2">
          {rows.map(([k, v], i) => (
            <div key={k} className="grid grid-cols-[90px_1fr] items-center text-[12.5px]">
              <span className="text-[#5b5e66]">{k}</span>
              <span className="relative inline-block">
                <span className="opacity-0">{v}</span>
                <motion.span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ background: INK }} initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ delay: 1 + i * 0.15, duration: 0.4 }} />
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[13px] leading-snug">
          The insurer knows the claim is <b>real</b> and <b>correct</b>. It never learns <b>why</b> Asha was in hospital — or which hospital it was.
        </div>
      </motion.div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ leak sweep
function LeakSweep({ phase, rows, total }: { phase: Phase; rows: ScanRow[]; total?: number }) {
  const human: Record<string, string> = {
    'Diagnosis text': 'Breast cancer',
    'Diagnosis code': 'Diagnosis code C50.9',
    Procedure: 'Chemotherapy',
    'Hospital name': 'Balco Medical Centre',
    'Patient wallet': 'Asha’s wallet address',
    'Bill total': 'Bill amount ₹87,000',
    'Sum insured': 'Her ₹5 lakh cover',
    'Hospital HFR id': 'Hospital registry ID',
  };
  const shown = rows.filter((r) => human[r.label]);
  const clean = phase === 'done' && rows.every((r) => r.hits === 0);
  return (
    <>
      {phase !== 'idle' && (
        <motion.div
          className="absolute z-30 top-[34px] w-[90px]"
          style={{ height: H - 44, background: `linear-gradient(90deg, transparent, ${TEAL}33, transparent)`, borderRight: `2px solid ${TEAL}` }}
          initial={{ x: 640 }}
          animate={{ x: [640, 1180, 640] }}
          transition={{ duration: 2.6, repeat: phase === 'run' ? Infinity : 0, ease: 'easeInOut' }}
        />
      )}
      <motion.div className="absolute z-30 rounded-[22px] grid place-items-start" style={{ left: 10, top: 30, width: 618, height: H - 36, background: 'rgba(245,242,234,.9)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="absolute bottom-4 left-0 right-0 text-center text-[12px] text-[#5b5e66]">
          Private side — never published, so there is nothing here to search.
        </div>
      </motion.div>
      <motion.div className="absolute z-40 card p-4 shadow-2xl" style={{ left: 150, top: 60, width: 340 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: TEAL }}>
          <ScanSearch size={14} /> Searching the whole public chain →
        </div>
        <div className="mt-2 space-y-1">
          {Object.values(human).map((label) => {
            const r = shown.find((x) => human[x.label] === label);
            return (
              <div key={label} className="flex justify-between text-[12.5px]">
                <span>“{label}”</span>
                {r ? (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-semibold" style={{ color: r.hits ? RED : GREEN }}>
                    {r.hits ? `${r.hits} found` : 'not found'}
                  </motion.span>
                ) : (
                  <span className="text-[#8a8d95]">{phase === 'idle' ? '—' : '…'}</span>
                )}
              </div>
            );
          })}
        </div>
        {clean && (
          <motion.div initial={{ scale: 1.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: -4 }} transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }} className="mt-3 rounded-lg border-2 text-center py-2" style={{ borderColor: GREEN, color: GREEN }}>
            <div className="font-bold tracking-wider text-[15px]">0 PRIVATE DETAILS FOUND</div>
            <div className="text-[11px]">{total ? `every one of ${total} transactions checked` : 'every transaction checked'}</div>
          </motion.div>
        )}
      </motion.div>
    </>
  );
}

// ------------------------------------------------------------------ fraud attempt
function Fraud({ amt, nul }: { amt: string; nul?: string }) {
  return (
    <motion.div className="absolute inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="absolute inset-0 rounded-[22px]" style={{ background: '#f5f2ea' }} />
      <div className="absolute left-[60px] top-[40px] text-[12.5px] font-semibold flex items-center gap-2">
        <span className="chip text-white" style={{ background: RED }}>
          TRY TO CHEAT
        </span>
        A fraudster copies Asha’s seal from the public chain and submits it again
      </div>
      {/* fraudster */}
      <At x={90} y={170}>
        <div className="flex flex-col items-center gap-2 w-[180px]">
          <Person coat="#3a3f4b" hair="#3a3f4b" size={86} />
          <Caption w={180}>
            <b className="text-[#16181d]">Fraudster</b> with a copy of the seal
          </Caption>
        </div>
      </At>
      {/* the contract */}
      <At x={600} y={140}>
        <div className="card p-4 w-[230px] h-[200px]" style={{ borderColor: TEAL }}>
          <div className="text-[11px] font-semibold" style={{ color: TEAL }}>
            Insurance contract
          </div>
          <div className="text-[11.5px] text-[#5b5e66] mt-1 leading-snug">Every seal carries a one-time claim number. This one is already spent.</div>
          <div className="mt-3 rounded-lg border border-[#ddd8cc] px-2 py-1.5 text-[11px]">
            <div className="text-[#8a8d95]">used claim numbers</div>
            <div className="mono">{nul ? nul.slice(0, 8) + '…' : '#'} ✓ paid {amt}</div>
          </div>
        </div>
      </At>
      <motion.div
        className="absolute left-0 top-0"
        initial={{ x: 290, y: 200, opacity: 0 }}
        animate={{ x: [290, 520, 290], y: [200, 180, 230], opacity: [0, 1, 1], rotate: [0, 0, -30] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1, times: [0, 0.5, 1], ease }}
      >
        <Seal amount={amt} size={96} />
      </motion.div>
      <motion.div
        className="absolute chip text-white !text-[13px] !py-1.5 !px-3"
        style={{ left: 450, top: 110, background: RED }}
        animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.8, 0.8, 1.12, 1, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, times: [0, 0.32, 0.4, 0.9, 1] }}
      >
        <ShieldX size={14} /> REJECTED · this seal was already used
      </motion.div>
      {/* everything else that fails */}
      <At x={880} y={110}>
        <div className="card p-4 w-[380px] text-[13px] leading-relaxed">
          <div className="font-semibold mb-1.5">Also rejected, automatically</div>
          {[
            ['Unlicensed clinic', 'no seal can be made'],
            ['Expired policy', 'no seal can be made'],
            ['Treatment not covered', 'no seal can be made'],
            ['Inflating the bill', 'no seal can be made'],
            ['Faking Asha’s consent', 'no seal can be made'],
            ['Redirecting the money', 'contract refuses'],
            ['Same Aadhaar, 2nd account', 'contract refuses'],
          ].map(([t, why], i) => (
            <motion.div key={t} className="flex items-center gap-2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.12 }}>
              <ShieldX size={14} style={{ color: RED }} /> <span className="flex-1">{t}</span>
              <span className="text-[11px] text-[#8a8d95]">{why}</span>
            </motion.div>
          ))}
          <div className="text-[11.5px] text-[#5b5e66] mt-2">14 real attacks run live in the Attack Lab →</div>
        </div>
      </At>
    </motion.div>
  );
}

// ------------------------------------------------------------------ "today" — the problem
function Today() {
  const readers = [
    { who: 'Insurer claims desk', y: 40 },
    { who: 'Third-party administrator', y: 150 },
    { who: 'Medical reviewer', y: 260 },
    { who: 'Claims database (forever)', y: 370 },
  ];
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = [900, 1500, 2100, 2700].map((ms, i) => setTimeout(() => setN(i + 1), ms));
    return () => t.forEach(clearTimeout);
  }, []);
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[14px] top-[8px] text-[12.5px] font-semibold flex items-center gap-2">
        <span className="chip text-white" style={{ background: RED }}>
          TODAY
        </span>
        How a cashless claim works now
      </div>
      {/* hospital with an open file */}
      <At x={40} y={110}>
        <div className="flex flex-col items-center gap-2">
          <Person coat="#6f6a60" size={56} />
          <MedFile
            rows={[
              ['Patient', 'Asha Verma'],
              ['Diagnosis', 'Breast cancer'],
              ['Treatment', 'Chemotherapy'],
              ['Bill', '₹87,000'],
            ]}
            w={150}
          />
          <Caption w={170}>The hospital must send the full file to get paid</Caption>
        </div>
      </At>
      {readers.map((r, i) => (
        <div key={r.who}>
          <Fly k={'copy' + i} from={[200, 220]} to={[520, r.y + 18]} delay={0.4 + i * 0.6} dur={1}>
            <div className="w-[64px] rounded border border-[#ddd8cc] bg-white p-1 text-[8px] shadow">
              <div className="font-semibold" style={{ color: RED }}>
                Breast cancer
              </div>
              <div className="h-1 bg-[#ddd8cc] rounded mt-0.5" />
              <div className="h-1 bg-[#ddd8cc] rounded mt-0.5 w-2/3" />
            </div>
          </Fly>
          <motion.div className="absolute flex items-center gap-3" style={{ left: 600, top: r.y }} initial={{ opacity: 0.25 }} animate={{ opacity: n > i ? 1 : 0.25 }}>
            <Person coat={['#3a3f4b', '#7a6a55', '#5e6b76', '#8a8d92'][i]} size={44} />
            <div className="text-[12.5px] leading-tight w-[200px]">
              <b>{r.who}</b>
              <div className="text-[#5b5e66] flex items-center gap-1">
                <Eye size={11} /> reads her diagnosis
              </div>
            </div>
          </motion.div>
        </div>
      ))}
      {/* right column: the cost */}
      <At x={900} y={40}>
        <div className="w-[350px] space-y-3">
          <div className="card p-4">
            <div className="serif text-[54px] leading-none" style={{ color: RED }}>
              {n}+
            </div>
            <div className="text-[13px]">strangers have now read why Asha was in hospital</div>
          </div>
          <div className="card p-3 flex gap-3 items-start text-[12.5px] leading-snug">
            <Clock3 size={18} className="shrink-0 mt-0.5" />
            <div>
              <b>Hours to days of back-and-forth</b> at discharge — queries, extra documents, a human approving each claim.
            </div>
          </div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.2 }} className="card p-3 flex gap-3 items-start text-[12.5px] leading-snug" style={{ borderColor: RED + '66' }}>
            <Newspaper size={18} className="shrink-0 mt-0.5" style={{ color: RED }} />
            <div>
              <b>Sept 2024:</b> names, medical reports and claims of ~31 million policyholders of one of India’s largest health insurers were reportedly leaked online.
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.8 }} className="card p-3 flex gap-3 items-start text-[12.5px] leading-snug">
            <TriangleAlert size={18} className="shrink-0 mt-0.5" style={{ color: '#b7791f' }} />
            <div>
              And still, <b>₹8,000–10,000 crore</b> a year leaks to claim fraud, waste and abuse (BCG × Medi Assist, 2025).
            </div>
          </motion.div>
        </div>
      </At>
    </div>
  );
}
