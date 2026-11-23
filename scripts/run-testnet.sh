#!/usr/bin/env bash
# Run the API (relayer, IPFS pin node, consent inbox) and the web app against the Base Sepolia deployment.
# Needs the files deploy-testnet.sh created: .testnet-keys.json, contracts/deployments/84532.json, app/public/demo.json, server/data/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RPC_URL="${RPC_URL:-https://base-sepolia-rpc.publicnode.com}" CHAIN_ID=84532 ROLE_KEYS="$ROOT/.testnet-keys.json" DATA_DIR="$ROOT/server/data-84532" LOG_CHUNK="${LOG_CHUNK:-2000}"
for f in "$ROLE_KEYS" "$ROOT/contracts/deployments/84532.json" "$ROOT/.demo-84532.json"; do
  [ -f "$f" ] || { echo "missing $f — run DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh first"; exit 1; }
done
LOGS="$ROOT/.logs"; mkdir -p "$LOGS"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
for port in 8787 5173; do fuser -k "$port/tcp" >/dev/null 2>&1 || true; done
node "$ROOT/sdk/scripts/export-abis.mjs" >/dev/null
cp "$ROOT/.demo-84532.json" "$ROOT/app/public/demo.json"   # demo.sh overwrites it with the local chain's
( cd "$ROOT/server" && npx tsx src/index.ts > "$LOGS/api.log" 2>&1 ) & PIDS+=($!)
( cd "$ROOT/app" && npx vite --port 5173 --host > "$LOGS/web.log" 2>&1 ) & PIDS+=($!)
sleep 3
echo "  Mohar on Base Sepolia →  http://localhost:5173   (explorer: https://sepolia.basescan.org)"
wait
