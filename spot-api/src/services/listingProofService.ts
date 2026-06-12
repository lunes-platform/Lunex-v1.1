import { config } from '../config';
import { subqueryClient, SubqueryListingEvent } from './subqueryClient';

export type ActivationProofVerificationInput = {
  ownerAddress: string;
  tokenAddress: string;
  tierNumber: number;
  onChainListingId: number;
  onChainLockId: number;
  pairAddress: string;
  lpAmount: string;
  txHash: string;
};

export type UnlockProofVerificationInput = {
  ownerAddress: string;
  onChainLockId?: number | null;
  lpAmount: string;
  txHash: string;
};

function normalizeAddress(value: string | null | undefined) {
  return String(value ?? '').trim();
}

function normalizeIntegerString(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return BigInt(String(value)).toString();
  } catch {
    return null;
  }
}

function requireListingProofVerifier() {
  if (config.nodeEnv === 'test') return false;
  if (!config.subquery.enabled || !subqueryClient.isEnabled()) {
    throw new Error(
      'Finalized listing proof verification requires SUBQUERY_ENDPOINT and SUBQUERY_ENABLED=true',
    );
  }
  return true;
}

function findTokenListedEvent(
  events: SubqueryListingEvent[],
  input: ActivationProofVerificationInput,
) {
  const expectedListingId = normalizeIntegerString(input.onChainListingId);
  return events.find(
    (event) =>
      event.kind === 'TOKEN_LISTED' &&
      normalizeIntegerString(event.listingId) === expectedListingId &&
      normalizeAddress(event.owner) === input.ownerAddress &&
      normalizeAddress(event.tokenAddress) === input.tokenAddress &&
      normalizeAddress(event.pairAddress) === input.pairAddress &&
      event.tier === input.tierNumber,
  );
}

function findLiquidityLockedEvent(
  events: SubqueryListingEvent[],
  input: ActivationProofVerificationInput,
) {
  const expectedLockId = normalizeIntegerString(input.onChainLockId);
  const expectedLpAmount = normalizeIntegerString(input.lpAmount);
  return events.find(
    (event) =>
      event.kind === 'LIQUIDITY_LOCKED' &&
      normalizeIntegerString(event.lockId) === expectedLockId &&
      normalizeAddress(event.owner) === input.ownerAddress &&
      normalizeAddress(event.pairAddress) === input.pairAddress &&
      normalizeIntegerString(event.lpAmount) === expectedLpAmount &&
      event.tier === input.tierNumber,
  );
}

export async function verifyListingActivationProof(
  input: ActivationProofVerificationInput,
) {
  if (!requireListingProofVerifier()) return;

  const events = await subqueryClient.getListingEventsByTxHash(input.txHash);
  const tokenListed = findTokenListedEvent(events, input);
  const liquidityLocked = findLiquidityLockedEvent(events, input);

  if (!tokenListed || !liquidityLocked) {
    throw new Error(
      'Finalized TokenListed and LiquidityLocked events were not found for the submitted activation proof',
    );
  }
}

export async function verifyListingUnlockProof(
  input: UnlockProofVerificationInput,
) {
  if (!requireListingProofVerifier()) return;

  const events = await subqueryClient.getListingEventsByTxHash(input.txHash);
  const expectedLockId = normalizeIntegerString(input.onChainLockId);
  const expectedLpAmount = normalizeIntegerString(input.lpAmount);
  const unlocked = events.find(
    (event) =>
      event.kind === 'LIQUIDITY_UNLOCKED' &&
      (!expectedLockId ||
        normalizeIntegerString(event.lockId) === expectedLockId) &&
      normalizeAddress(event.owner) === input.ownerAddress &&
      normalizeIntegerString(event.lpAmount) === expectedLpAmount,
  );

  if (!unlocked) {
    throw new Error(
      'Finalized LiquidityUnlocked event was not found for the submitted withdraw proof',
    );
  }
}
