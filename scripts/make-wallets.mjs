// Creates fresh role wallets for the local chain (gitignored .role-wallets.json, same format as .testnet-keys.json).
// The two patients keep the wallets their Anon Aadhaar proofs are bound to (a proof's signal is the wallet address;
// re-proving takes minutes and ~7 GB RAM), every other role gets a brand-new random key.
//   node scripts/make-wallets.mjs          (no-op if the file exists)
//   node scripts/make-wallets.mjs --force  (new keys)
import { createRequire } from 'node:module';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
const require = createRequire(new URL('../sdk/package.json', import.meta.url));
const { Wallet } = require('ethers');
const OUT = new URL('../.role-wallets.json', import.meta.url).pathname;
if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('role wallets: using existing .role-wallets.json');
  process.exit(0);
}
// order = sdk/scripts/chain.ts ROLES
const ROLES = ['regulator', 'insurer', 'patient', 'patient2', 'doctor', 'relayer', 'guardian1', 'guardian2', 'guardian3', 'responder', 'lab', 'pharmacy'];
const AADHAAR_BOUND = {
  patient: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  patient2: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};
const keys = ROLES.map((r) => AADHAAR_BOUND[r] ?? Wallet.createRandom().privateKey);
writeFileSync(OUT, JSON.stringify(keys, null, 1));
chmodSync(OUT, 0o600);
console.log('role wallets: created .role-wallets.json');
