import { useState } from 'react';
import { Eye, FileLock2, ShieldX } from 'lucide-react';
import { PageHeader } from '../App';
import { Card, Chip, Empty, Spinner, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { c, events, getDemo, nameOf, revertReason, Role, short } from '../lib/chain';
import { openRecord } from '../lib/flow';
import { KIND_META, useIdentity } from '../lib/session';

const PURPOSE: Record<string, string> = { doctor: 'clinical review', lab: 'run lab order', pharmacy: 'dispense prescription' };

/** Doctor / Lab / Pharmacy — "records shared with me". */
export function Provider() {
  const d = getDemo();
  const id = useIdentity()!;
  const role = id.role as Role;
  const me = d.accounts[role].address;
  const meta = KIND_META[id.kind];
  const { data } = useAsync(
    async () => {
      const ev = await events('vault', 'AccessGranted', null, me);
      const ids = [...new Set(ev.map((e) => e.args.recordId as string))];
      return Promise.all(
        ids.map(async (rid) => {
          const r = await c().vault.records(rid);
          const g = await c().vault.getGrant(rid, me);
          return { id: rid, owner: r.owner, kind: r.kind, version: Number(r.version), can: await c().vault.canAccess(rid, me), expiresAt: Number(g.expiresAt) };
        }),
      );
    },
    [me],
    4000,
  );
  const views = useAsync(async () => (await events('vault', 'AccessLogged', null, me)).reverse().slice(0, 12), [me], 4000);
  const [doc, setDoc] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  return (
    <div className="space-y-6">
      <PageHeader
        title={id.name}
        sub={`${meta.blurb} Opening a record writes an audit entry on-chain first — the contract refuses if the grant was revoked or has expired.`}
        right={
          <div className="text-right text-[12px] text-muted">
            <div className="label">{meta.label} wallet</div>
            <div className="mono">{short(me, 6)}</div>
          </div>
        }
      />
      <Card title="Shared with me" icon={<FileLock2 size={18} />}>
        {!data?.length && <Empty>No patient has shared anything with you yet. (Patient → My records → Share)</Empty>}
        <div className="space-y-3">
          {(data ?? []).map((r) => (
            <div key={r.id} className="rounded-md border border-line p-4">
              <div className="flex justify-between items-center flex-wrap gap-3">
                <div>
                  <div className="font-semibold">
                    {nameOf(r.owner)} · <span className="capitalize">{r.kind.replace('-', ' ')}</span> <span className="text-muted text-xs">v{r.version}</span>
                  </div>
                  <div className="text-xs text-muted">{r.can ? `access until ${new Date(r.expiresAt * 1000).toLocaleString('en-IN')}` : 'access revoked or expired — and the record was re-keyed'}</div>
                </div>
                <div className="flex gap-2 items-center">
                  <Chip tone={r.can ? 'mint' : 'rose'}>{r.can ? 'active' : 'no access'}</Chip>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      setBusy(r.id);
                      setErr({ ...err, [r.id]: '' });
                      try {
                        setDoc({ ...doc, [r.id]: await openRecord(role, r.id, PURPOSE[id.kind] ?? 'review') });
                      } catch (e) {
                        setErr({ ...err, [r.id]: revertReason(e) });
                        setDoc({ ...doc, [r.id]: null });
                      }
                      setBusy('');
                    }}
                  >
                    {busy === r.id ? <Spinner /> : <Eye size={15} />} Open (logged)
                  </button>
                </div>
              </div>
              {err[r.id] && (
                <div className="text-sm text-rose mt-2 flex items-center gap-2">
                  <ShieldX size={15} /> Blocked by HealthVault: {err[r.id]}
                </div>
              )}
              {doc[r.id] && (
                <div className="mt-3">
                  <FhirView bundle={doc[r.id]} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
      <Card title="My access log (on-chain)" sub="The patient sees exactly these entries in their audit trail.">
        {!views.data?.length && <Empty>No views yet.</Empty>}
        <ul className="space-y-1.5 text-[13px]">
          {(views.data ?? []).map((e: any) => (
            <li key={e.transactionHash + e.index} className="flex gap-3">
              <Eye size={14} className="text-amber mt-0.5" />
              <span className="flex-1">
                Viewed a record — “{e.args.purpose}” · {new Date(Number(e.args.at) * 1000).toLocaleTimeString('en-IN')}
              </span>
              <span className="mono text-xs text-muted">#{e.blockNumber}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
