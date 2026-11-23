#!/usr/bin/env bash
# Deploy Mohar to Base Sepolia (chain 84532) and seed it.
#   DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh
# Needs ~0.001 Base Sepolia ETH on the deployer (faucets: https://docs.base.org/chain/network-faucets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RPC_URL="${RPC_URL:-https://base-sepolia-rpc.publicnode.com}" CHAIN_ID=84532 DATA_DIR="$ROOT/server/data-84532"
: "${DEPLOYER_KEY:?set DEPLOYER_KEY to a funded Base Sepolia key}"
KEYS="$ROOT/.testnet-keys.json"
if [ ! -f "$KEYS" ]; then
  node -e "const {Wallet}=require('$ROOT/sdk/node_modules/ethers');console.log(JSON.stringify(Array.from({length:12},()=>Wallet.createRandom().privateKey)))" > "$KEYS"
  chmod 600 "$KEYS"
fi
export ROLE_KEYS="$KEYS"
# Anon Aadhaar proofs are bound to the patient wallet → make one for each fresh patient key (≈2–4 min, ~7 GB RAM each).
for i in 2 3; do
  a=$(cast wallet address --private-key "$(node -e "console.log(require('$KEYS')[$i])")")
  f="$ROOT/.cache/anon-aadhaar/proof-$(echo "$a" | tr 'A-F' 'a-f')-11651504.json"
  [ -f "$f" ] || { echo "▸ Anon Aadhaar proof for patient $a (one-time, a few minutes)"; ( cd "$ROOT/sdk" && NODE_OPTIONS="--require $ROOT/sdk/scripts/few-cpus.cjs" node scripts/aadhaar-prove.mjs "$a" ); }
done
DEPLOYER_ADDR=$(cast wallet address --private-key "$DEPLOYER_KEY")
echo "▸ funding role accounts from $DEPLOYER_ADDR"
# Sized to real Base Sepolia costs (~0.01 gwei): deploying everything is ~14M gas ≈ 0.00014 ETH.
# order = ROLES: regulator insurer patient patient2 doctor relayer guardian1-3 responder lab pharmacy
AMOUNTS=(0.00035 0.00004 0.00005 0.00005 0.000015 0.00015 0.000015 0.000015 0.000015 0.000015 0.000015 0.000015)
i=0
for k in $(node -e "for (const k of require('$KEYS')) console.log(k)"); do
  a=$(cast wallet address --private-key "$k")
  want=$(cast to-wei "${AMOUNTS[$i]}" ether)
  bal=$(cast balance "$a" --rpc-url "$RPC_URL")
  if [ "$(echo "$bal < $want" | bc)" = 1 ]; then
    cast send "$a" --value "$(echo "$want - $bal" | bc)" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL" >/dev/null && echo "  funded $a (${AMOUNTS[$i]} ETH)"
  fi
  i=$((i + 1))
done
echo "▸ deploy (regulator = role 0)"
REG_KEY=$(node -e "console.log(require('$KEYS')[0])")
( cd "$ROOT/contracts" && forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$REG_KEY" --slow )
node "$ROOT/sdk/scripts/export-abis.mjs"
echo "▸ seed"
( cd "$ROOT/sdk" && PUBLIC_RPC_URL="$RPC_URL" npx tsx scripts/seed.ts )
echo "✓ deployed: $(cat "$ROOT/contracts/deployments/84532.json")"
echo "  role wallets for MetaMask → ROLE-WALLETS.base-sepolia.md"
echo "  start the app on Base Sepolia:  ./scripts/run-testnet.sh"
