import { SubstrateEvent } from '@subql/types';
import { ListingEvent } from '../types';
import {
  makeEventId,
  safeNum,
  getOrCreateDailyStats,
  dateToIsoDate,
} from './utils';
import { labelGuard } from './contractEvents';

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

  const args = event.event.data.toJSON() as Record<string, unknown>;
  const owner = String(args.owner ?? signer ?? '');
  const listingId =
    args.listing_id !== undefined ? BigInt(String(args.listing_id)) : undefined;
  const tokenAddress = String(args.token_address ?? '');
  const pairAddress = args.pair_address ? String(args.pair_address) : undefined;
  const tier = args.tier ? Number(args.tier) : undefined;
  const lockId =
    args.lock_id !== undefined ? BigInt(String(args.lock_id)) : undefined;
  const listingFee = safeNum(args.listing_fee);
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
    listingFee,
    burnAmount: (listingFee * BigInt(50)) / BigInt(100),
    treasuryAmount: (listingFee * BigInt(30)) / BigInt(100),
    rewardsAmount: (listingFee * BigInt(20)) / BigInt(100),
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

  const args = event.event.data.toJSON() as Record<string, unknown>;
  const lockId =
    args.lock_id !== undefined ? BigInt(String(args.lock_id)) : undefined;
  const owner = String(args.owner ?? signer ?? '');
  const pairAddress = args.pair_address ? String(args.pair_address) : undefined;
  const lpTokenAddress = args.lp_token ? String(args.lp_token) : undefined;
  const lpAmount = safeNum(args.lp_amount);
  const lunesAmount = safeNum(args.lunes_amount);
  const tokenAmount = safeNum(args.token_amount);
  const tier = args.tier ? Number(args.tier) : undefined;
  const unlockTs = args.unlock_timestamp
    ? BigInt(String(args.unlock_timestamp))
    : undefined;

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
    lpTokenAddress,
    lpAmount,
    lunesAmount,
    tokenAmount,
    unlockTimestamp: unlockTs,
    tier,
    listingFee: undefined,
    burnAmount: undefined,
    treasuryAmount: undefined,
    rewardsAmount: undefined,
  });

  await ev.save();

  const day = await getOrCreateDailyStats(dateToIsoDate(timestamp));
  day.totalLunesLocked = (day.totalLunesLocked ?? BigInt(0)) + lunesAmount;
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

  const args = event.event.data.toJSON() as Record<string, unknown>;
  const owner = String(args.owner ?? signer ?? '');
  const burnAmount = safeNum(args.burn_amount);
  const treasuryAmount = safeNum(args.treasury_amount);
  const rewardsAmount = safeNum(args.rewards_amount);
  const listingFee = burnAmount + treasuryAmount + rewardsAmount;
  const id = makeEventId(blockNumber, extrinsic?.idx ?? 0, idx);

  const ev = ListingEvent.create({
    id,
    blockNumber,
    timestamp,
    extrinsicHash,
    contractAddress: raw.contract,
    kind: 'FEE_DISTRIBUTED',
    listingId: undefined,
    lockId: undefined,
    owner,
    tokenAddress: args.token_address ? String(args.token_address) : undefined,
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

  const args = event.event.data.toJSON() as Record<string, unknown>;
  const lockId =
    args.lock_id !== undefined ? BigInt(String(args.lock_id)) : undefined;
  const owner = String(args.owner ?? signer ?? '');
  const lpAmount = safeNum(args.lp_amount);
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
