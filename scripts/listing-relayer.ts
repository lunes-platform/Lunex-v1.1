#!/usr/bin/env ts-node
/**
 * listing-relayer.ts
 *
 * Listens for on-chain TokenListed and LiquidityLocked events emitted by the
 * ListingManager and LiquidityLock contracts, then calls the spot-api to
 * activate or update the corresponding database records.
 *
 * Usage:
 *   npx ts-node scripts/listing-relayer.ts
 *
 * Required env vars (reads from spot-api/.env automatically):
 *   LISTING_MANAGER_CONTRACT_ADDRESS
 *   LIQUIDITY_LOCK_CONTRACT_ADDRESS
 *   LUNES_WS_URL                       (default: ws://127.0.0.1:9944)
 *   SPOT_API_URL                       (default: http://localhost:4000)
 *   ADMIN_SECRET                       (required)
 *   LISTING_RELAYER_STATE_FILE         (default: .state/listing-relayer-state.json)
 *   LISTING_RELAYER_START_BLOCK        (optional first-run replay start)
 *   LISTING_RELAYER_REPLAY_BLOCKS      (default: 128)
 *   LISTING_RELAYER_METRICS_PORT       (default: 9471)
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as http from 'http';

// ── Load env ──────────────────────────────────────────────────────

const envPath = path.resolve(__dirname, '../spot-api/.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[relayer] Loaded env from ${envPath}`);
} else {
  dotenv.config();
}

const WS_URL = process.env.LUNES_WS_URL || 'ws://127.0.0.1:9944';
const API_BASE = process.env.SPOT_API_URL || 'http://localhost:4000';
const MANAGER_ADDR = process.env.LISTING_MANAGER_CONTRACT_ADDRESS || '';
const LOCK_ADDR = process.env.LIQUIDITY_LOCK_CONTRACT_ADDRESS || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const STATE_FILE =
  process.env.LISTING_RELAYER_STATE_FILE ||
  path.resolve(__dirname, '../.state/listing-relayer-state.json');
function parseNonNegativeInt(value: string | undefined, fallback: number) {
  const parsed = parseInt(value || String(fallback), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function parseOptionalPositiveInt(value: string | undefined) {
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const REPLAY_BLOCKS = parseNonNegativeInt(
  process.env.LISTING_RELAYER_REPLAY_BLOCKS,
  128,
);
const START_BLOCK = parseOptionalPositiveInt(
  process.env.LISTING_RELAYER_START_BLOCK,
);
const METRICS_PORT = parseNonNegativeInt(
  process.env.LISTING_RELAYER_METRICS_PORT,
  9471,
);

// ── Types ─────────────────────────────────────────────────────────

interface TokenListedEvent {
  listingId: number;
  owner: string;
  tokenAddress: string;
  pairAddress: string;
  tier: number;
  lockId: number;
}

interface LiquidityLockedEvent {
  lockId: number;
  owner: string;
  pairAddress: string;
  lpAmount: string;
  unlockTimestamp: string;
  tier: number;
}

interface PendingActivation {
  tokenListed?: TokenListedEvent;
  liquidityLocked?: LiquidityLockedEvent;
  txHash: string;
}

interface RelayerState {
  lastFinalizedBlock: number;
  lastFinalizedHash: string;
  updatedAt: string;
}

interface RelayerMetrics {
  startedAt: number;
  lastFinalizedBlock: number;
  lastFinalizedAt: number;
  processedBlocksTotal: number;
  failedBlocksTotal: number;
  activationSuccessTotal: number;
  activationFailureTotal: number;
  withdrawSuccessTotal: number;
  withdrawFailureTotal: number;
}

// ── Logger ────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[relayer] ${msg}`);
}
function warn(msg: string) {
  console.warn(`[relayer] ⚠ ${msg}`);
}
function err(msg: string) {
  console.error(`[relayer] ❌ ${msg}`);
}

// ── Durable cursor ───────────────────────────────────────────────

function loadState(): RelayerState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return {
        lastFinalizedBlock: 0,
        lastFinalizedHash: '',
        updatedAt: new Date(0).toISOString(),
      };
    }
    const parsed = JSON.parse(
      fs.readFileSync(STATE_FILE, 'utf8'),
    ) as Partial<RelayerState>;
    return {
      lastFinalizedBlock: Number(parsed.lastFinalizedBlock ?? 0),
      lastFinalizedHash: String(parsed.lastFinalizedHash ?? ''),
      updatedAt: String(parsed.updatedAt ?? new Date(0).toISOString()),
    };
  } catch (e) {
    throw new Error(`Failed to read relayer state file ${STATE_FILE}: ${e}`);
  }
}

function saveState(state: RelayerState) {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, STATE_FILE);
}

function renderMetrics(metrics: RelayerMetrics) {
  const now = Date.now();
  const cursorAgeSeconds =
    metrics.lastFinalizedAt > 0
      ? Math.max(0, Math.floor((now - metrics.lastFinalizedAt) / 1000))
      : -1;

  return [
    '# HELP lunex_listing_relayer_up Whether the listing relayer process is running',
    '# TYPE lunex_listing_relayer_up gauge',
    'lunex_listing_relayer_up 1',
    '# HELP lunex_listing_relayer_uptime_seconds Process uptime in seconds',
    '# TYPE lunex_listing_relayer_uptime_seconds gauge',
    `lunex_listing_relayer_uptime_seconds ${Math.floor(
      (now - metrics.startedAt) / 1000,
    )}`,
    '# HELP lunex_listing_relayer_last_finalized_block Last finalized block successfully processed by the listing relayer',
    '# TYPE lunex_listing_relayer_last_finalized_block gauge',
    `lunex_listing_relayer_last_finalized_block ${metrics.lastFinalizedBlock}`,
    '# HELP lunex_listing_relayer_cursor_age_seconds Age of the persisted finalized cursor in seconds',
    '# TYPE lunex_listing_relayer_cursor_age_seconds gauge',
    `lunex_listing_relayer_cursor_age_seconds ${cursorAgeSeconds}`,
    '# HELP lunex_listing_relayer_processed_blocks_total Finalized blocks successfully processed',
    '# TYPE lunex_listing_relayer_processed_blocks_total counter',
    `lunex_listing_relayer_processed_blocks_total ${metrics.processedBlocksTotal}`,
    '# HELP lunex_listing_relayer_failed_blocks_total Finalized blocks that failed processing before cursor advance',
    '# TYPE lunex_listing_relayer_failed_blocks_total counter',
    `lunex_listing_relayer_failed_blocks_total ${metrics.failedBlocksTotal}`,
    '# HELP lunex_listing_relayer_activation_success_total Successful listing activation API calls',
    '# TYPE lunex_listing_relayer_activation_success_total counter',
    `lunex_listing_relayer_activation_success_total ${metrics.activationSuccessTotal}`,
    '# HELP lunex_listing_relayer_activation_failure_total Failed listing activation API calls',
    '# TYPE lunex_listing_relayer_activation_failure_total counter',
    `lunex_listing_relayer_activation_failure_total ${metrics.activationFailureTotal}`,
    '# HELP lunex_listing_relayer_withdraw_success_total Successful lock withdraw finalization API calls',
    '# TYPE lunex_listing_relayer_withdraw_success_total counter',
    `lunex_listing_relayer_withdraw_success_total ${metrics.withdrawSuccessTotal}`,
    '# HELP lunex_listing_relayer_withdraw_failure_total Failed lock withdraw finalization API calls',
    '# TYPE lunex_listing_relayer_withdraw_failure_total counter',
    `lunex_listing_relayer_withdraw_failure_total ${metrics.withdrawFailureTotal}`,
    '',
  ].join('\n');
}

function startMetricsServer(metrics: RelayerMetrics) {
  if (METRICS_PORT <= 0) {
    warn('Metrics server disabled because LISTING_RELAYER_METRICS_PORT <= 0');
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(renderMetrics(metrics));
  });

  server.listen(METRICS_PORT, '0.0.0.0', () => {
    log(`Metrics endpoint: :${METRICS_PORT}/metrics`);
  });
  return server;
}

// ── API calls ─────────────────────────────────────────────────────

async function activateListing(
  listingId: string,
  proof: TokenListedEvent & { lpAmount: string; txHash: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/listing/${listingId}/activate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      onChainListingId: proof.listingId,
      onChainLockId: proof.lockId,
      pairAddress: proof.pairAddress,
      // The LiquidityLock contract does not emit a separate LP token address.
      // In the current AMM model the pair contract is the LP token issuer.
      lpTokenAddress: proof.pairAddress,
      lpAmount: proof.lpAmount,
      txHash: proof.txHash,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to activate listing ${listingId}: ${data.error}`);
  }
  log(
    `✅ Listing ${listingId} activated (on-chain ID: ${proof.listingId}, lock ID: ${proof.lockId})`,
  );
}

async function findListingByTokenAddress(
  tokenAddress: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/listing/token/${tokenAddress}`);
    if (res.status === 404) return null;
    const data = await res.json();
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function withdrawLockRecord(
  onChainLockId: number,
  ownerAddress: string,
  txHash: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/v1/listing/lock/onchain/${onChainLockId}/withdraw-finalized`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ownerAddress, txHash }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Failed to mark on-chain lock ${onChainLockId} withdrawn: ${data.error}`,
    );
  }
  log(`✅ On-chain lock ${onChainLockId} marked as withdrawn`);
}

// ── Event decoders ────────────────────────────────────────────────

function decodeTokenListedEvent(data: any[]): TokenListedEvent | null {
  try {
    return {
      listingId: Number(data[0]),
      owner: String(data[1]),
      tokenAddress: String(data[2]),
      pairAddress: String(data[3]),
      tier: Number(data[4]),
      lockId: Number(data[5]),
    };
  } catch {
    return null;
  }
}

function decodeLiquidityLockedEvent(data: any[]): LiquidityLockedEvent | null {
  try {
    return {
      lockId: Number(data[0]),
      owner: String(data[1]),
      pairAddress: String(data[2]),
      lpAmount: String(data[3]),
      unlockTimestamp: String(data[4]),
      tier: Number(data[5]),
    };
  } catch {
    return null;
  }
}

function decodeLiquidityUnlockedEvent(
  data: any[],
): { lockId: number; owner: string; lpAmount: string } | null {
  try {
    return {
      lockId: Number(data[0]),
      owner: String(data[1]),
      lpAmount: String(data[2]),
    };
  } catch {
    return null;
  }
}

// ── Reconnect with exponential backoff ───────────────────────────

async function connectWithRetry(
  wsUrl: string,
  maxRetries = 10,
): Promise<ApiPromise> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`Connecting to ${wsUrl} (attempt ${attempt})…`);
      const provider = new WsProvider(wsUrl);
      const api = await ApiPromise.create({ provider });
      await api.isReady;
      log('Connected ✅');
      return api;
    } catch (e) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
      warn(`Connection failed: ${e}. Retrying in ${delay / 1000}s…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`Failed to connect to ${wsUrl} after ${maxRetries} attempts`);
}

// ── Main event loop ───────────────────────────────────────────────

async function main() {
  if (!MANAGER_ADDR) {
    err(
      'LISTING_MANAGER_CONTRACT_ADDRESS is not set. Run deploy-listing-contracts.ts first.',
    );
    process.exit(1);
  }
  if (!LOCK_ADDR) {
    err(
      'LIQUIDITY_LOCK_CONTRACT_ADDRESS is not set. Run deploy-listing-contracts.ts first.',
    );
    process.exit(1);
  }
  if (!ADMIN_SECRET) {
    err(
      'ADMIN_SECRET is not set. Relayer cannot call protected spot-api endpoints.',
    );
    process.exit(1);
  }

  log(`Listing Manager : ${MANAGER_ADDR}`);
  log(`Liquidity Lock  : ${LOCK_ADDR}`);
  log(`API endpoint    : ${API_BASE}`);
  log(`State file      : ${STATE_FILE}`);
  log(`Start block     : ${START_BLOCK ?? 'cursor/replay-window'}`);
  log(`Replay window   : ${REPLAY_BLOCKS} finalized blocks`);

  // Verify API is reachable
  try {
    const health = await fetch(`${API_BASE}/health`);
    const data = await health.json();
    log(`API health: ${data.status} | DB: ${data.db} | Redis: ${data.redis}`);
  } catch {
    warn('Could not reach spot-api /health — will retry events anyway');
  }

  let api = await connectWithRetry(WS_URL);

  log('Subscribing to finalized contracts.ContractEmitted events…');

  // Track processed events to avoid duplicates after reconnects
  const processed = new Set<string>();
  const pendingActivations = new Map<string, PendingActivation>();
  let state = loadState();
  const metrics: RelayerMetrics = {
    startedAt: Date.now(),
    lastFinalizedBlock: state.lastFinalizedBlock,
    lastFinalizedAt: state.updatedAt ? Date.parse(state.updatedAt) || 0 : 0,
    processedBlocksTotal: 0,
    failedBlocksTotal: 0,
    activationSuccessTotal: 0,
    activationFailureTotal: 0,
    withdrawSuccessTotal: 0,
    withdrawFailureTotal: 0,
  };
  const metricsServer = startMetricsServer(metrics);
  log(
    `Loaded cursor   : block=${state.lastFinalizedBlock} hash=${
      state.lastFinalizedHash || 'none'
    }`,
  );

  let unsub: (() => void) | null = null;

  function getTxHashForEvent(block: any, record: any) {
    if (!record.phase?.isApplyExtrinsic) return null;
    const extrinsicIndex = record.phase.asApplyExtrinsic.toNumber();
    return block.block.extrinsics[extrinsicIndex]?.hash?.toHex?.() ?? null;
  }

  function queueActivation(
    txHash: string,
    update: Partial<PendingActivation>,
    eventTasks: Promise<void>[],
  ) {
    const pending = pendingActivations.get(txHash) ?? { txHash };
    Object.assign(pending, update);
    pendingActivations.set(txHash, pending);

    if (!pending.tokenListed || !pending.liquidityLocked) return;
    if (pending.tokenListed.lockId !== pending.liquidityLocked.lockId) return;

    const listed = pending.tokenListed;
    const locked = pending.liquidityLocked;
    pendingActivations.delete(txHash);

    eventTasks.push(
      findListingByTokenAddress(listed.tokenAddress)
        .then((dbId) => {
          if (!dbId) {
            throw new Error(
              `No DB listing found for token ${listed.tokenAddress}`,
            );
          }
          return activateListing(dbId, {
            ...listed,
            lpAmount: locked.lpAmount,
            txHash,
          });
        })
        .then(() => {
          metrics.activationSuccessTotal += 1;
        })
        .catch((e) => {
          metrics.activationFailureTotal += 1;
          throw e;
        }),
    );
  }

  async function processFinalizedBlock(
    blockHash: any,
    source: 'replay' | 'live',
  ) {
    const [rawEvents, block] = await Promise.all([
      api.query.system.events.at(blockHash),
      api.rpc.chain.getBlock(blockHash),
    ]);
    const events = rawEvents as unknown as any[];
    const blockNumber = Number(block.block.header.number.toString());
    const blockHashString = blockHash.toString();
    const eventTasks: Promise<void>[] = [];

    if (source === 'live' && blockNumber <= state.lastFinalizedBlock) {
      return;
    }

    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const record = events[eventIndex] as any;
      const { event } = record;

      if (event.section !== 'contracts' || event.method !== 'ContractEmitted') {
        continue;
      }

      const [contractAddr, eventData] = event.data as any[];
      const addr = contractAddr.toString();
      const txHash = getTxHashForEvent(block, record);
      if (!txHash) continue;

      // Deduplicate by block hash + event index
      const dedupKey = `${blockHash.toString()}:${eventIndex}:${addr}`;
      if (processed.has(dedupKey)) continue;
      processed.add(dedupKey);

      const rawData = eventData.toJSON ? eventData.toJSON() : [];

      if (addr === MANAGER_ADDR) {
        handleManagerEvent(rawData, txHash, eventTasks);
      } else if (addr === LOCK_ADDR) {
        handleLockEvent(rawData, txHash, eventTasks);
      }
    }

    const results = await Promise.allSettled(eventTasks);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') {
      metrics.failedBlocksTotal += 1;
      throw rejected.reason;
    }

    if (blockNumber > state.lastFinalizedBlock) {
      state = {
        lastFinalizedBlock: blockNumber,
        lastFinalizedHash: blockHashString,
        updatedAt: new Date().toISOString(),
      };
      saveState(state);
      metrics.lastFinalizedBlock = blockNumber;
      metrics.lastFinalizedAt = Date.now();
      metrics.processedBlocksTotal += 1;
    }
  }

  async function replayFromCursor() {
    const latestHash = await api.rpc.chain.getFinalizedHead();
    const latestHeader = await api.rpc.chain.getHeader(latestHash);
    const latestBlock = Number(latestHeader.number.toString());
    const startBlock =
      state.lastFinalizedBlock > 0
        ? Math.max(1, state.lastFinalizedBlock - REPLAY_BLOCKS + 1)
        : START_BLOCK ?? Math.max(1, latestBlock - REPLAY_BLOCKS + 1);

    if (startBlock > latestBlock) return;

    log(`Replaying finalized blocks ${startBlock}..${latestBlock}`);
    for (
      let blockNumber = startBlock;
      blockNumber <= latestBlock;
      blockNumber++
    ) {
      const hash = await api.rpc.chain.getBlockHash(blockNumber);
      await processFinalizedBlock(hash, 'replay');
    }
  }

  async function processLiveHead(header: any) {
    const currentBlock = Number(header.number.toString());
    const startBlock = Math.max(1, state.lastFinalizedBlock + 1);

    for (
      let blockNumber = startBlock;
      blockNumber <= currentBlock;
      blockNumber++
    ) {
      const hash =
        blockNumber === currentBlock
          ? header.hash
          : await api.rpc.chain.getBlockHash(blockNumber);
      await processFinalizedBlock(hash, 'live');
    }
  }

  async function subscribe() {
    unsub = (await api.rpc.chain.subscribeFinalizedHeads((header) => {
      processLiveHead(header).catch((e) => {
        err(
          `Failed to process finalized block ${
            header.hash?.toString?.() ?? ''
          }: ${e}`,
        );
      });
    })) as unknown as () => void;
  }

  function handleManagerEvent(
    rawData: any,
    txHash: string,
    eventTasks: Promise<void>[],
  ) {
    // The event identifier is encoded in the first topic byte of the data.
    // For simplicity we attempt to decode all known event shapes.

    // Try TokenListed
    const listed = decodeTokenListedEvent(
      Array.isArray(rawData) ? rawData : [],
    );
    if (listed && listed.tokenAddress) {
      log(
        `📋 TokenListed event — token: ${listed.tokenAddress}, tier: ${listed.tier}, on-chain ID: ${listed.listingId}`,
      );
      queueActivation(txHash, { tokenListed: listed, txHash }, eventTasks);
    }

    // Try FeeDistributed
    if (
      Array.isArray(rawData) &&
      rawData.length >= 4 &&
      !listed?.tokenAddress
    ) {
      log(
        `💸 FeeDistributed — listing ${rawData[0]}: burn=${rawData[1]}, treasury=${rawData[2]}, rewards=${rawData[3]}`,
      );
    }
  }

  function handleLockEvent(
    rawData: any,
    txHash: string,
    eventTasks: Promise<void>[],
  ) {
    const arr = Array.isArray(rawData) ? rawData : [];

    // LiquidityLocked has 6 fields
    if (arr.length >= 6) {
      const locked = decodeLiquidityLockedEvent(arr);
      if (locked) {
        log(
          `🔒 LiquidityLocked — lock ${locked.lockId}, owner: ${locked.owner}, tier: ${locked.tier}, unlock: ${locked.unlockTimestamp}`,
        );
        queueActivation(
          txHash,
          { liquidityLocked: locked, txHash },
          eventTasks,
        );
        return;
      }
    }

    // LiquidityUnlocked has 3 fields
    if (arr.length === 3) {
      const unlocked = decodeLiquidityUnlockedEvent(arr);
      if (unlocked) {
        log(
          `🔓 LiquidityUnlocked — lock ${unlocked.lockId}, owner: ${unlocked.owner}, amount: ${unlocked.lpAmount}`,
        );
        eventTasks.push(
          withdrawLockRecord(unlocked.lockId, unlocked.owner, txHash)
            .then(() => {
              metrics.withdrawSuccessTotal += 1;
            })
            .catch((e) => {
              metrics.withdrawFailureTotal += 1;
              throw e;
            }),
        );
      }
    }
  }

  await replayFromCursor();
  await subscribe();
  log('Listening for listing events… (Ctrl+C to stop)');

  // ── Handle disconnections ────────────────────────────────────────
  api.on('disconnected', async () => {
    warn('Node disconnected — reconnecting…');
    if (unsub) {
      try {
        unsub();
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 3_000));
    try {
      api = await connectWithRetry(WS_URL);
      await subscribe();
      log('Resubscribed after reconnect');
    } catch (e) {
      err(`Failed to reconnect: ${e}`);
      process.exit(1);
    }
  });

  // Keep process alive
  process.on('SIGINT', () => {
    if (unsub) unsub();
    metricsServer?.close();
    api.disconnect();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    if (unsub) unsub();
    metricsServer?.close();
    api.disconnect();
    process.exit(0);
  });
}

main().catch((e) => {
  err(String(e));
  process.exit(1);
});
