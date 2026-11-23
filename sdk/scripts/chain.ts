// Shared chain helpers for scripts + server: ABIs from Foundry artifacts, deployment, demo accounts.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Contract, FetchRequest, JsonRpcProvider, Wallet, NonceManager } from 'ethers';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const ROOT = root;

export function abi(name: string) {
  return JSON.parse(readFileSync(`${root}contracts/out/${name}.sol/${name}.json`, 'utf8')).abi;
}

export function deployment(chainId = Number(process.env.CHAIN_ID ?? 31337)) {
  const f = `${root}contracts/deployments/${chainId}.json`;
  if (!existsSync(f)) throw new Error(`no deployment for chain ${chainId} — run deploy first`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

// Anvil's well-known dev keys — DEMO ONLY.
export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  '0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897',
  '0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82',
];

// Public testnets: fresh role keys from a gitignored file (Anvil keys are swept by bots even on testnets).
export const KEYS: string[] = process.env.ROLE_KEYS ? JSON.parse(readFileSync(process.env.ROLE_KEYS, 'utf8')) : ANVIL_KEYS;

export const ROLES = {
  regulator: 0,
  insurer: 1,
  patient: 2,
  patient2: 3,
  doctor: 4,
  relayer: 5,
  guardian1: 6,
  guardian2: 7,
  guardian3: 8,
  responder: 9,
  lab: 10,
  pharmacy: 11,
} as const;

export function provider(rpc = process.env.RPC_URL ?? 'http://127.0.0.1:8545') {
  const req = new FetchRequest(rpc);
  req.timeout = 15_000; // a stalled public-RPC call must fail fast, not hang the relayer / indexer for 5 minutes
  return new JsonRpcProvider(req, undefined, { cacheTimeout: -1, pollingInterval: 500 });
}

export function signer(role: keyof typeof ROLES, p = provider()) {
  return new NonceManager(new Wallet(KEYS[ROLES[role]], p));
}

export function contracts(runner: any, d = deployment()) {
  return {
    token: new Contract(d.token, abi('BINR'), runner),
    regulator: new Contract(d.regulator, abi('Regulator'), runner),
    claims: new Contract(d.claimSettlement, abi('ClaimSettlement'), runner),
    vault: new Contract(d.healthVault, abi('HealthVault'), runner),
    breakGlass: new Contract(d.breakGlass, abi('BreakGlass'), runner),
    verifier: new Contract(d.verifier, abi('HonkVerifier'), runner),
    patients: d.patientRegistry ? new Contract(d.patientRegistry, abi('PatientRegistry'), runner) : (null as any),
  };
}
