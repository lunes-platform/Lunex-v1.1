import { SubstrateEvent } from '@subql/types';
import { ListingEvent } from '../types';
import {
  makeEventId,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils';
import {
  labelGuard,
  decodeTokenListed,
  decodeFeeDistributed,
  decodeLiquidityLocked,
  decodeLiquidityUnlocked,
} from './contractEvents';

// ── ListingManager: TokenListed ────────────────────────────────
export async function handleTokenListed(event: SubstrateEvent): Promise<void> {
  const { block, extrinsic, idx } = event;
  const blockNumber = BigInt(block.block.header.number.toString());
  const timestamp = block.timestamp ?? new Date();
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined;
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined;

  // Discriminate by ink! string topic; bail on any non-TokenListed event.
  const raw = labelGuard(event, ['ListingManager::TokenListed']);
  if (!raw) return;

  const decoded = decodeTokenListed(raw.payload);
  if (!decoded) return;
  const owner = decoded.owner || signer || '';
  const listingId = decoded.listingId;
  const tokenAddress = decoded.tokenAddress;
  const pairAddress = decoded.pairAddress;
  const tier = decoded.tier;
  const lockId = decoded.lockId;
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx);

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'TOKEN_LISTED',
    listingId,
    lockId,
    owner,
    tokenAddress,
    pairAddress,
    lpTokenAddress: undefined,
    lpAmount: undefined,
    lunesAmount: undefined,
    tokenAmount: undefined,
    unlockTimestamp: undefined,
    tier,
    // Fee split is emitted separately via FeeDistributed; not part of this event.
    listingFee: undefined,
    burnAmount: undefined,
    treasuryAmount: undefined,
    rewardsAmount: undefined,
  });

  await ev.save();

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp));
  day.newListings = (day.newListings ?? 0) + 1;
  await day.save();
}

// ── LiquidityLock: LiquidityLocked ────────────────────────────
export async function handleLiquidityLocked(
  event: SubstrateEvent,
): Promise<void> {
  const { block, extrinsic, idx } = event;
  const blockNumber = BigInt(block.block.header.number.toString());
  const timestamp = block.timestamp ?? new Date();
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined;
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined;

  // Discriminate by ink! string topic; bail on any non-LiquidityLocked event.
  const raw = labelGuard(event, ['LiquidityLock::LiquidityLocked']);
  if (!raw) return;

  const decoded = decodeLiquidityLocked(raw.payload);
  if (!decoded) return;
  const lockId = decoded.lockId;
  const owner = decoded.owner || signer || '';
  const pairAddress = decoded.pairAddress;
  const lpAmount = decoded.lpAmount;
  const tier = decoded.tier;
  const unlockTs = decoded.unlockTimestamp;

  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx);

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'LIQUIDITY_LOCKED',
    listingId: undefined,
    lockId,
    owner,
    tokenAddress: undefined,
    pairAddress,
    lpTokenAddress: undefined,
    lpAmount,
    lunesAmount: undefined,
    tokenAmount: undefined,
    unlockTimestamp: unlockTs,
    tier,
    listingFee: undefined,
    burnAmount: undefined,
    treasuryAmount: undefined,
    rewardsAmount: undefined,
  });

  await ev.save();

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp));
  day.totalLunesLocked = (day.totalLunesLocked ?? BigInt(0)) + lpAmount;
  await day.save();
}

// ── ListingManager: FeeDistributed ────────────────────────────
export async function handleFeeDistributed(
  event: SubstrateEvent,
): Promise<void> {
  const { block, extrinsic, idx } = event;
  const blockNumber = BigInt(block.block.header.number.toString());
  const timestamp = block.timestamp ?? new Date();
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined;
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined;

  // Discriminate by ink! string topic; bail on any non-FeeDistributed event.
  const raw = labelGuard(event, ['ListingManager::FeeDistributed']);
  if (!raw) return;

  const decoded = decodeFeeDistributed(raw.payload);
  if (!decoded) return;
  const owner = signer ?? '';
  // On-chain split is staking / treasury / rewards. There is no dedicated
  // staking column, so the staking portion is stored in burnAmount.
  const burnAmount = decoded.stakingAmount;
  const treasuryAmount = decoded.treasuryAmount;
  const rewardsAmount = decoded.rewardsAmount;
  const listingFee = burnAmount + treasuryAmount + rewardsAmount;
  const listingId = decoded.listingId;
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx);

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'FEE_DISTRIBUTED',
    listingId,
    lockId: undefined,
    owner,
    tokenAddress: undefined,
    pairAddress: undefined,
    lpTokenAddress: undefined,
    lpAmount: undefined,
    lunesAmount: undefined,
    tokenAmount: undefined,
    unlockTimestamp: undefined,
    tier: undefined,
    listingFee,
    burnAmount,
    treasuryAmount,
    rewardsAmount,
  });

  await ev.save();
}

// ── LiquidityLock: LiquidityUnlocked ──────────────────────────
export async function handleLiquidityUnlocked(
  event: SubstrateEvent,
): Promise<void> {
  const { block, extrinsic, idx } = event;
  const blockNumber = BigInt(block.block.header.number.toString());
  const timestamp = block.timestamp ?? new Date();
  const extrinsicHash = extrinsic?.extrinsic.hash.toString() ?? undefined;
  const signer = extrinsic?.extrinsic.signer?.toString() ?? undefined;

  // Discriminate by ink! string topic; bail on any non-LiquidityUnlocked event.
  const raw = labelGuard(event, ['LiquidityLock::LiquidityUnlocked']);
  if (!raw) return;

  const decoded = decodeLiquidityUnlocked(raw.payload);
  if (!decoded) return;
  const lockId = decoded.lockId;
  const owner = decoded.owner || signer || '';
  const lpAmount = decoded.lpAmount;
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx);

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'LIQUIDITY_UNLOCKED',
    listingId: undefined,
    lockId,
    owner,
    tokenAddress: undefined,
    pairAddress: undefined,
    lpTokenAddress: undefined,
    lpAmount,
    lunesAmount: undefined,
    tokenAmount: undefined,
    unlockTimestamp: undefined,
    tier: undefined,
    listingFee: undefined,
    burnAmount: undefined,
    treasuryAmount: undefined,
    rewardsAmount: undefined,
  });

  await ev.save();
}
