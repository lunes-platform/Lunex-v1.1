---
description: Deploy listing contracts (LiquidityLock + ListingManager) to testnet/mainnet and start the listing relayer
---

# Deploy Listing Contracts

Complete flow for deploying the LiquidityLock and ListingManager ink! contracts and wiring them into the Lunex backend.

## Prerequisites

- Rust + cargo-contract installed: `cargo install cargo-contract`
- Node testnet running (or WS URL configured)
- Deployer account funded with at least 50 LUNES
- `spot-api/.env` exists with at least `LUNES_WS_URL` and `RELAYER_SEED`

---

## Step 1 — Set environment variables

```bash
export RELAYER_SEED="//Alice"              # or your actual seed phrase
export LUNES_WS_URL="ws://127.0.0.1:9944" # local testnet
export NETWORK=local                       # local | testnet | mainnet

# Optional (defaults to deployer address if not set)
export TREASURY_ADDRESS=""
export REWARDS_POOL_ADDRESS=""
export LUNES_TOKEN_ADDRESS=""              # WLUNES PSP22 address on target network
```

---

## Step 2 — Dry run (no on-chain tx, just validates build)

// turbo
```bash
DRY_RUN=true npx ts-node scripts/deploy-listing-contracts.ts
```

---

## Step 3 — Deploy contracts

```bash
npx ts-node scripts/deploy-listing-contracts.ts
```

This script will:
1. `cargo contract build --release` for both contracts
2. Instantiate `LiquidityLock` on-chain
3. Instantiate `ListingManager` on-chain (with LiquidityLock address)
4. Call `LiquidityLock.set_manager(listingManagerAddress)` to authorize it
5. Write `LISTING_MANAGER_CONTRACT_ADDRESS` and `LIQUIDITY_LOCK_CONTRACT_ADDRESS` into:
   - `spot-api/.env`
   - `docker/.env.docker`
6. Save a JSON deployment summary to `deployment/listing-deploy-<timestamp>.json`

---

## Step 4 — Restart the API

```bash
# Local dev
npx ts-node spot-api/src/index.ts

# Docker
docker compose -f docker/docker-compose.prod.yml up -d api
```

---

## Step 5 — Start the listing relayer

The relayer listens for on-chain `TokenListed` and `LiquidityUnlocked` events and automatically calls the spot-api to activate or withdraw listings.

```bash
npx ts-node scripts/listing-relayer.ts
```

The relayer:
- Connects to the blockchain node via WebSocket
- Listens for `contracts.ContractEmitted` events from `LISTING_MANAGER_CONTRACT_ADDRESS` and `LIQUIDITY_LOCK_CONTRACT_ADDRESS`
- On `TokenListed`: calls `POST /api/v1/listing/:id/activate`
- On `LiquidityUnlocked`: calls `POST /api/v1/listing/lock/:lockId/withdraw`
- Auto-reconnects on node disconnections

---

## Manual activation (without relayer)

If you prefer manual activation after confirming a listing on-chain:

```bash
# Activate a listing after on-chain confirmation
curl -X POST http://localhost:4000/api/v1/listing/<listing-db-id>/activate \
  -H "Content-Type: application/json" \
  -d '{"onChainListingId": 0}'

# Check listing status
curl http://localhost:4000/api/v1/listing/<listing-db-id>

# Get all active listings
curl "http://localhost:4000/api/v1/listing?status=ACTIVE"

# Check stats
curl http://localhost:4000/api/v1/listing/stats
```

---

## Troubleshooting

**Build fails with "contract not found"**
- Check that `contracts/liquidity_lock/Cargo.toml` and `contracts/listing_manager/Cargo.toml` exist
- Run: `cargo contract build --manifest-path contracts/liquidity_lock/Cargo.toml`

**Insufficient balance**
- Fund the deployer: use the faucet at `scripts/send_tokens.ts` or use `polkadot.js apps`

**Relayer not detecting events**
- Confirm the contract addresses are correct: `echo $LISTING_MANAGER_CONTRACT_ADDRESS`
- Check node is running: `curl -s http://localhost:9944`

**Listing not activating**
- Check relayer logs for event decoding errors
- Manually activate: see "Manual activation" section above
