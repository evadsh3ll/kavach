import { useState } from 'react';
import { HOSP_DEPTH, MerkleTree, toHex32 } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Check, Chip, Hex, Spinner, useAsync } from '../components/ui';
import { api } from '../lib/zk';

const ZERO = '0x' + '0'.repeat(64);
import { c, events, getDemo, revertReason } from '../lib/chain';

const STATUS = ['None', 'Pending', 'Approved', 'Revoked'];

export function RegulatorPage() {
  const d = getDemo();
  const { data, reload } = useAsync(
    async () => {
      const k = c();
      const n = Number(await k.regulator.hospitalCount());
      const hs = await Promise.all([...Array(n).keys()].map(async (i) => ({ i, ...(await k.regulator.hospitals(i)).toObject() })));
      const root: string = await k.regulator.currentRoot();
      const leaves: string[] = await k.regulator.approvedLeaves();
      const local = toHex32((await MerkleTree.build(HOSP_DEPTH, leaves.map(BigInt))).root);
      const paused: boolean = await k.regulator.paused();
      const roots = await events('regulator', 'RootPublished');
      return { hs, root, local, paused, roots: roots.reverse().slice(0, 6) };
    },
    [],
    4000,
  );
  const [busy, setBusy] = useState('');
  const [check, setCheck] = useState<Record<number, any>>({});

  async function act(key: string, fn: () => Promise<any>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      alert(revertReason(e));
    }
    setBusy('');
    reload();
  }

  async function republish(revocation: boolean) {
    const leaves: string[] = await c().regulator.approvedLeaves();
    const tree = await MerkleTree.build(HOSP_DEPTH, leaves.map(BigInt));
    await (await c('regulator').regulator.publishRoot(toHex32(tree.root), revocation)).wait();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="Regulator · licensing registry"
        sub="Publishes the Merkle root of licensed hospitals. The list is public; which one filed a claim is not. Revocation kills every older root instantly."
        right={
          <button className={`btn ${data?.paused ? 'btn-primary' : 'btn-danger'}`} onClick={() => act('pause', async () => (await c('regulator').regulator.setPaused(!data?.paused)).wait())}>
            {busy === 'pause' ? <Spinner /> : data?.paused ? 'Resume settlements' : 'Emergency pause'}
          </button>
        }
      />
      <Card title="Root audit" sub="Anyone can rebuild the tree from the approved leaves and compare it with the published root.">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="label">Published on-chain</div>
            <Hex v={data?.root ?? ''} n={14} />
          </div>
          <div>
            <div className="label">Recomputed in this browser</div>
            <Hex v={data?.local ?? ''} n={14} /> {data && <Chip tone={data.root === data.local ? 'mint' : 'amber'}>{data.root === data.local ? '✓ matches' : 'stale — republish'}</Chip>}
          </div>
        </div>
      </Card>
      <Card title="Hospitals" sub="Leaf = Poseidon2(domain, hospital secret). The hospital's wallet is never recorded.">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left label">
              <th className="py-2">Hospital</th>
              <th>ABDM HFR</th>
              <th>Leaf</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.hs ?? []).map((h: any) => (
              <tr key={h.i} className="border-t border-line">
                <td className="py-2.5 font-medium">{h.name}</td>
                <td className="mono text-xs">
                  {h.hfrId}
                  {h.attestation !== ZERO && <div className="text-[10.5px] text-mint not-mono">attested · {h.attestationSource}</div>}
                  {check[h.i] && h.attestation === ZERO && (
                    <div className="mt-1 space-y-0.5 font-sans">
                      {check[h.i].checks.map((k: any) => (
                        <Check key={k.label} ok={k.ok}>
                          <span className="text-[11.5px]">{k.label}</span>
                        </Check>
                      ))}
                      <div className="text-[10.5px] text-muted">source: {check[h.i].source}</div>
                    </div>
                  )}
                </td>
                <td>
                  <Hex v={h.leaf} n={5} />
                </td>
                <td>
                  <Chip tone={Number(h.status) === 2 ? 'mint' : Number(h.status) === 1 ? 'amber' : 'rose'}>{STATUS[Number(h.status)]}</Chip>
                </td>
                <td className="text-right space-x-2">
                  {Number(h.status) === 1 && h.attestation === ZERO && (
                    <button className="btn btn-ghost !py-1" onClick={() => act('v' + h.i, async () => setCheck({ ...check, [h.i]: await api(`/registry/hfr/${h.hfrId}?name=${encodeURIComponent(h.name)}`) }))}>
                      {busy === 'v' + h.i ? <Spinner /> : 'Check ABDM HFR'}
                    </button>
                  )}
                  {Number(h.status) === 1 && h.attestation === ZERO && check[h.i]?.ok && (
                    <button className="btn btn-ghost !py-1" onClick={() => act('t' + h.i, async () => (await c('regulator').regulator.attestHospital(h.i, check[h.i].attestation, check[h.i].source)).wait())}>
                      {busy === 't' + h.i ? <Spinner /> : 'Attest on-chain'}
                    </button>
                  )}
                  {Number(h.status) === 1 && h.attestation !== ZERO && (
                    <button className="btn btn-primary !py-1" onClick={() => act('a' + h.i, async () => (await (await c('regulator').regulator.approveHospital(h.i)).wait(), republish(false)))}>
                      {busy === 'a' + h.i ? <Spinner /> : 'Approve + publish root'}
                    </button>
                  )}
                  {Number(h.status) === 2 && (
                    <button className="btn btn-danger !py-1" onClick={() => act('r' + h.i, async () => (await (await c('regulator').regulator.revokeHospital(h.i)).wait(), republish(true)))}>
                      {busy === 'r' + h.i ? <Spinner /> : 'Revoke'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Clinicians />
      <Card title="Root history">
        <ul className="text-sm space-y-1.5">
          {(data?.roots ?? []).map((r: any) => (
            <li key={r.transactionHash} className="flex gap-3 items-center">
              <span className="mono text-muted text-xs">#{r.blockNumber}</span>
              <Hex v={r.args.root} n={10} />
              {r.args.revocation ? <Chip tone="rose">revocation · older roots dead</Chip> : <Chip>routine · 15 min grace</Chip>}
            </li>
          ))}
        </ul>
        <div className="text-xs text-muted mt-3">Insurer on record: {d.names.insurer} (IRDAI/HLT/2026/147)</div>
      </Card>
    </div>
  );
}

function Clinicians() {
  const d = getDemo();
  const { data, reload } = useAsync(async () => (await events('regulator', 'ClinicianRegistered')).map((e) => e.args), [], 5000);
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const who = d.accounts.guardian2.address; // Dr. Kavita Rao
  return (
    <Card
      title="Clinicians · NMC Indian Medical Register"
      sub="Patients can only grant Doctor-role access to NMC-verified clinicians (enforced by HealthVault)."
      right={
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={async () => (setBusy('v'), setV(await api(`/registry/nmc?reg=${encodeURIComponent('CGMC/2016/7720')}&name=${encodeURIComponent('Dr. Kavita Rao')}`)), setBusy(''))}>
            {busy === 'v' ? <Spinner /> : null} Check Dr. Kavita Rao · CGMC/2016/7720
          </button>
          {v?.ok && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                setBusy('r');
                await (await c('regulator').regulator.registerClinician(who, 'Dr. Kavita Rao', 'CGMC/2016/7720', v.attestation)).wait();
                setBusy('');
                setV(null);
                reload();
              }}
            >
              {busy === 'r' ? <Spinner /> : null} Register on-chain
            </button>
          )}
        </div>
      }
    >
      {v && (
        <div className="mb-3 grid sm:grid-cols-2 gap-2">
          {v.checks.map((k: any) => (
            <Check key={k.label} ok={k.ok}>
              {k.label}
            </Check>
          ))}
          <div className="text-xs text-muted">
            {v.record.council} · {v.record.qualification} · source {v.source}
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <tbody>
          {(data ?? []).map((a: any) => (
            <tr key={a.clinician} className="border-t border-line">
              <td className="py-2 font-medium">{a.name}</td>
              <td className="mono text-xs">{a.nmcRegNo}</td>
              <td>
                <Hex v={a.attestation} n={5} />
              </td>
              <td className="text-right">
                <Chip tone="mint">NMC verified</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
