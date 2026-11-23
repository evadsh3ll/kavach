// Wallet layer. Two ways to act as a role:
//   • MetaMask (default for sign-in): transactions and signatures pop up in the user's wallet.
//   • Built-in demo wallet: keys from demo.json, no pop-ups (Story mode, Attack Lab, phone links, tests).
// Encryption and consent keys are never stored: they are re-derived from a deterministic wallet
// signature (personal_sign, RFC 6979), so MetaMask and a raw key produce exactly the same key.
import { BrowserProvider, JsonRpcSigner, Wallet, hexlify, toUtf8Bytes, toBeHex } from 'ethers';
import { consentKeyFromSignature, consentKeyMessage, encryptionKeyFromSignature, encryptionKeyMessage } from '@kavach/sdk';
import { getDemo, Role } from './chain';
import { trace } from './trace';

export type WalletMode = 'metamask' | 'demo';
const MODE_KEY = 'mohar.wallet.v1';

const eth = () => (window as any).ethereum as { request: (a: { method: string; params?: any[] }) => Promise<any>; on?: any; removeListener?: any } | undefined;
export const hasMetaMask = () => !!eth();

let mode: WalletMode = (() => {
  try {
    return (sessionStorage.getItem(MODE_KEY) as WalletMode) || 'demo';
  } catch {
    return 'demo';
  }
})();
let mmRole: Role | null = null; // the role this tab signed in as through MetaMask
let forceDemo = false; // presenter screens (Story, Attack Lab) always use built-in keys

export const walletMode = () => mode;
export function setWalletMode(m: WalletMode) {
  mode = m;
  try {
    sessionStorage.setItem(MODE_KEY, m);
  } catch {}
}
export function setMetaMaskRole(r: Role | null) {
  mmRole = r;
}
export function setForceDemo(v: boolean) {
  forceDemo = v;
}
/** Should this role's signatures go through MetaMask in this tab? */
export const viaMetaMask = (role: Role) => !forceDemo && mode === 'metamask' && mmRole === role && hasMetaMask();

// ---------------------------------------------------------------- network
export function networkParams() {
  const d = getDemo() as any;
  const id = Number(d.network?.chainId ?? d.deployment.chainId ?? 31337);
  const n =
    d.network ??
    (id === 84532
      ? { chainId: id, name: 'Base Sepolia', publicRpc: 'https://base-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.basescan.org' }
      : { chainId: id, name: 'Mohar local chain', publicRpc: 'http://127.0.0.1:8545', explorer: null });
  return {
    chainId: toBeHex(n.chainId),
    chainName: n.name,
    rpcUrls: [n.publicRpc],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    ...(n.explorer ? { blockExplorerUrls: [n.explorer] } : {}),
    _id: Number(n.chainId),
  };
}

export async function ensureChain() {
  const e = eth();
  if (!e) throw new Error('MetaMask not found');
  const { _id, ...p } = networkParams();
  const current = await e.request({ method: 'eth_chainId' });
  if (Number(current) === _id) return;
  try {
    await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: p.chainId }] });
  } catch (err: any) {
    if (err?.code === 4902 || /Unrecognized chain|not been added/i.test(String(err?.message))) {
      await e.request({ method: 'wallet_addEthereumChain', params: [p] });
    } else throw err;
  }
}

/** Ask MetaMask for accounts (prompts the first time) and return the ones it shares with this site. */
export async function connectMetaMask(): Promise<string[]> {
  const e = eth();
  if (!e) throw new Error('MetaMask not found');
  await ensureChain();
  return (await e.request({ method: 'eth_requestAccounts' })) as string[];
}
export async function metaMaskAccounts(): Promise<string[]> {
  const e = eth();
  return e ? ((await e.request({ method: 'eth_accounts' })) as string[]) : [];
}
export function onAccountsChanged(f: (a: string[]) => void) {
  const e = eth();
  e?.on?.('accountsChanged', f);
  return () => e?.removeListener?.('accountsChanged', f);
}

// ---------------------------------------------------------------- signing
/** personal_sign as `address` — through MetaMask, or with a demo key. */
export async function personalSignAs(address: string, msg: string, demoKey?: string, useMetaMask = mode === 'metamask' && !forceDemo) {
  if (useMetaMask && hasMetaMask()) return (await eth()!.request({ method: 'personal_sign', params: [hexlify(toUtf8Bytes(msg)), address] })) as string;
  if (!demoKey) throw new Error('no key for ' + address);
  return new Wallet(demoKey).signMessage(msg);
}

async function signFor(role: Role, msg: string) {
  const a = getDemo().accounts[role];
  return personalSignAs(a.address, msg, a.privateKey, viaMetaMask(role));
}

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
async function derived(k: string, make: () => Promise<string>) {
  if (cache.has(k)) return cache.get(k)!;
  if (!inflight.has(k)) inflight.set(k, make().then((v) => (cache.set(k, v), inflight.delete(k), v), (e) => (inflight.delete(k), Promise.reject(e))));
  return inflight.get(k)!;
}

/** This role's ECIES decryption key (derived, never stored on-chain or on a server). */
export function encPriv(role: Role): Promise<string> {
  const via = viaMetaMask(role) ? 'mm' : 'demo';
  return derived(`enc:${role}:${via}`, async () => {
    const k = encryptionKeyFromSignature(await signFor(role, encryptionKeyMessage)).privateKey;
    trace({ kind: 'crypto', title: 'Derived decryption key from a wallet signature', detail: via === 'mm' ? 'signed in MetaMask · the key exists only in this tab' : 'demo wallet', vis: 'private' });
    return k;
  });
}

/** The patient's per-policy consent key (used to sign claim terms; its public half is inside the policy commitment). */
export function consentPriv(role: Role, policyId: bigint): Promise<string> {
  const via = viaMetaMask(role) ? 'mm' : 'demo';
  return derived(`consent:${role}:${policyId}:${via}`, async () => consentKeyFromSignature(await signFor(role, consentKeyMessage(policyId))).privateKey);
}

export function clearDerivedKeys() {
  cache.clear();
}

let bp: BrowserProvider | null = null;
export function metaMaskSigner(address: string) {
  if (!bp) bp = new BrowserProvider(eth()!, 'any');
  return new JsonRpcSigner(bp, address);
}

/** Block-explorer link for a tx (Base Sepolia → BaseScan); null on the local chain. */
export function txUrl(hash: string): string | null {
  const ex = (networkParams() as any).blockExplorerUrls?.[0];
  return ex ? `${ex}/tx/${hash}` : null;
}
