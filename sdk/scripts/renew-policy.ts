// Insurer issues a fresh policy for a patient with the same plan terms (new policy ID + salt → new commitment,
// so the sum insured starts full again). Used to reset a demo patient whose cover was used up by test claims.
//   npx tsx scripts/renew-policy.ts asha          (local)
//   CHAIN_ID=84532 RPC_URL=https://sepolia.base.org ROLE_KEYS=../.testnet-keys.json npx tsx scripts/renew-policy.ts asha
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Wallet } from 'ethers';
import { consentKeyFor, newPolicy, policyCommitment, policyFromJSON, policyToJSON, randomField, toHex32 } from '../src/index.js';
import { KEYS, ROLES, ROOT, contracts, provider, signer } from './chain.js';

const who = (process.argv[2] ?? 'asha') as 'asha' | 'rahul';
const role = who === 'asha' ? 'patient' : 'patient2';
const chainId = Number(process.env.CHAIN_ID ?? 31337);
const files = [`${ROOT}app/public/demo.json`, ...(chainId !== 31337 ? [`${ROOT}.demo-${chainId}.json`] : [])].filter(existsSync);
const src = chainId !== 31337 ? `${ROOT}.demo-${chainId}.json` : `${ROOT}app/public/demo.json`;
const demo = JSON.parse(readFileSync(src, 'utf8'));
const old = policyFromJSON(demo.policies[who].json);
const pid = randomField();
const pol = newPolicy({ ...old, policyId: pid, salt: undefined, patientPubKey: consentKeyFor(new Wallet(KEYS[ROLES[role]]).privateKey, pid).publicKey });
const commitment = toHex32(await policyCommitment(pol));
const ins = contracts(signer('insurer', provider()));
await (await ins.claims.issuePolicy(commitment)).wait();
demo.policies[who] = { json: policyToJSON(pol), commitment };
for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  if (d.deployment?.claimSettlement !== demo.deployment.claimSettlement) continue; // only the same deployment
  d.policies[who] = demo.policies[who];
  writeFileSync(f, JSON.stringify(d, null, 2));
}
console.log(`✓ new ${pol.planName} policy for ${pol.patientName}: ${commitment} (full sum insured)`);
process.exit(0);
