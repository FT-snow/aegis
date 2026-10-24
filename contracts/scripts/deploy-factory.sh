#!/usr/bin/env bash
# Deploys AegisAccountFactory to Base Sepolia (84532).
# Usage: DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... ./contracts/scripts/deploy-factory.sh
# Keep the deployer key in your shell session only; never commit or paste it.
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in your shell, not in files}"
: "${RPC_URL:?Set RPC_URL to a Base Sepolia HTTPS endpoint}"

export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null 2>&1 || {
  echo "Foundry not installed. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup" >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [ "$CHAIN_ID" != "84532" ]; then
  if [ "${APP_ENV:-}" = "local" ] && [ "$CHAIN_ID" = "31337" ]; then
    echo "Local rehearsal mode on chain 31337 (APP_ENV=local)"
  else
    echo "Refusing to deploy to chain $CHAIN_ID; only Base Sepolia (84532) is allowed" >&2
    exit 1
  fi
fi

ENTRY_POINT="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7c"

DEPLOY_OUTPUT="$(forge create src/AegisAccountFactory.sol:AegisAccountFactory \
  --root contracts \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$ENTRY_POINT" "$USDC" 2>&1)" || true

FACTORY_ADDRESS="$(printf '%s\n' "$DEPLOY_OUTPUT" | sed -n 's/^Deployed to: //p' | tail -1 | tr -d '[:space:]')"
if [ -z "$FACTORY_ADDRESS" ]; then
  printf '%s\n' "$DEPLOY_OUTPUT" >&2
  exit 1
fi

echo "AegisAccountFactory deployed: $FACTORY_ADDRESS"
echo "Add to apps/worker/.dev.vars:  AEGIS_FACTORY_ADDRESS=$FACTORY_ADDRESS"
