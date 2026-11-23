import { ReactNode, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Camera, Download, ImageUp, ScanLine, X } from 'lucide-react';
import { trace } from '../lib/trace';

/** Renders a QR for `value`. `big` opens a full-screen version you can point a camera at. */
export function QrImage({ value, size = 168, label, download }: { value: string; size?: number; label?: string; download?: string }) {
  const [src, setSrc] = useState('');
  const [big, setBig] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 720, errorCorrectionLevel: value.length > 1500 ? 'L' : 'M', color: { dark: '#16181d', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [value]);
  if (!src) return <div style={{ width: size, height: size }} className="rounded-lg bg-panel2" />;
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <button onClick={() => setBig(true)} title="Show full screen to scan" className="rounded-lg border border-line bg-white p-1.5 hover:shadow-md transition">
        <img src={src} style={{ width: size, height: size }} alt={label ?? 'QR code'} />
      </button>
      <div className="flex gap-3 text-[11.5px] text-muted">
        <button className="hover:text-fg underline-offset-2 hover:underline" onClick={() => setBig(true)}>
          full screen
        </button>
        {download && (
          <a className="hover:text-fg underline-offset-2 hover:underline inline-flex items-center gap-1" href={src} download={download}>
            <Download size={11} /> PNG
          </a>
        )}
      </div>
      {big && (
        <div className="fixed inset-0 z-[60] bg-text/80 grid place-items-center p-6" onClick={() => setBig(false)}>
          <div className="bg-white rounded-lg p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <img src={src} className="w-[min(70vh,80vw)] h-[min(70vh,80vw)]" alt="" />
            {label && <div className="mt-3 text-[15px] font-semibold text-[#16181d]">{label}</div>}
            <button className="btn btn-ghost mt-3" onClick={() => setBig(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Camera / photo QR scanner with a demo shortcut (for stages with no second device). */
export function QrScanner({
  open,
  onClose,
  onResult,
  title,
  hint,
  demo,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
  title: string;
  hint?: ReactNode;
  demo?: { label: string; value: string };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState('');
  const [cam, setCam] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    setErr('');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs https or localhost.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setCam(true);
        const tick = () => {
          if (!alive) return;
          const cv = canvas.current!;
          if (v.videoWidth) {
            cv.width = v.videoWidth;
            cv.height = v.videoHeight;
            const g = cv.getContext('2d', { willReadFrequently: true })!;
            g.drawImage(v, 0, 0);
            const img = g.getImageData(0, 0, cv.width, cv.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) return done(code.data, 'camera');
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e: any) {
        setCam(false);
        setErr(e?.name === 'NotAllowedError' ? 'Camera permission denied — upload a photo of the QR instead.' : e?.message ?? 'No camera found — upload a photo of the QR instead.');
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      setCam(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function done(text: string, via: string) {
    trace({ kind: 'id', title: `QR scanned (${via})`, detail: text.length > 90 ? text.slice(0, 90) + '…' : text });
    onResult(text);
    onClose();
  }

  async function fromFile(f: File) {
    const bmp = await createImageBitmap(f);
    const cv = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    cv.width = bmp.width * scale;
    cv.height = bmp.height * scale;
    const g = cv.getContext('2d')!;
    g.drawImage(bmp, 0, 0, cv.width, cv.height);
    const img = g.getImageData(0, 0, cv.width, cv.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code?.data) done(code.data, 'photo');
    else setErr('No QR code found in that image.');
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-text/60 grid place-items-center p-4" onClick={onClose}>
      <div className="card p-5 w-[460px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 font-semibold">
            <ScanLine size={17} /> {title}
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <div className="relative rounded-md overflow-hidden bg-[#0d0f13] aspect-[4/3] grid place-items-center">
          <video ref={video} className={`absolute inset-0 w-full h-full object-cover ${cam ? '' : 'hidden'}`} muted playsInline />
          {cam && <div className="absolute inset-[18%] border-2 border-white/80 rounded-md shadow-[0_0_0_999px_rgba(0,0,0,.35)]" />}
          {!cam && (
            <div className="text-center text-white/70 text-sm px-6">
              <Camera className="mx-auto mb-2 opacity-70" />
              {err || 'Starting camera…'}
            </div>
          )}
          <canvas ref={canvas} className="hidden" />
        </div>
        {hint && <div className="text-[12.5px] text-muted mt-3 leading-relaxed">{hint}</div>}
        <div className="flex gap-2 mt-4 flex-wrap">
          <label className="btn btn-ghost cursor-pointer">
            <ImageUp size={15} /> Upload photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && fromFile(e.target.files[0])} />
          </label>
          {demo && (
            <button className="btn btn-primary" onClick={() => done(demo.value, 'demo shortcut')}>
              {demo.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
