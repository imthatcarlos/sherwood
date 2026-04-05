#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source .env

echo "Deploying MockWOOD + Uniswap V3 pool to Base Sepolia..."
echo "Using deployer key from DEPLOYER_PRIVATE_KEY env var"

forge script script/testnet/DeployMMTestnet.s.sol:DeployMMTestnet \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast \
  --verify \
  --verifier-url https://api-sepolia.basescan.org/api \
  --etherscan-api-key "$BASESCAN_API_KEY" \
  -vvvv
