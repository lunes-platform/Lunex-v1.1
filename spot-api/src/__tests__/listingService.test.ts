import { ListingStatus, ListingTier } from '@prisma/client';

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    tokenListing: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    liquidityLock: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/tokenRegistryService', () => ({
  registerToken: jest.fn(),
}));

import prisma from '../db';
import { registerToken } from '../services/tokenRegistryService';
import { activateListing, createListing } from '../services/listingService';

const prismaMock = prisma as unknown as {
  tokenListing: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  liquidityLock: {
    create: jest.Mock;
    update: jest.Mock;
  };
};

const registerTokenMock = registerToken as jest.Mock;

describe('listingService production safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.tokenListing.findUnique.mockResolvedValue(null);
    prismaMock.tokenListing.create.mockImplementation(async ({ data }) => ({
      id: 'listing-1',
      ...data,
      liquidityLock: null,
    }));
    prismaMock.tokenListing.update.mockImplementation(async ({ data }) => ({
      id: 'listing-1',
      ownerAddress: '5OwnerAddress',
      tokenAddress: '5TokenAddress',
      tokenName: 'Token',
      tokenSymbol: 'TOK',
      tokenDecimals: 12,
      tier: ListingTier.BASIC,
      lunesLiquidity: '10000',
      tokenLiquidity: '1000000',
      logoURI: null,
      liquidityLock: null,
      ...data,
    }));
    prismaMock.liquidityLock.create.mockResolvedValue({ id: 'lock-1' });
    registerTokenMock.mockResolvedValue({ id: 'token-1' });
  });

  it('creates a pending application without a fake LOCKED liquidity record', async () => {
    await createListing({
      ownerAddress: '5OwnerAddress',
      tokenAddress: '5TokenAddress',
      tokenName: 'Token',
      tokenSymbol: 'TOK',
      tokenDecimals: 12,
      tier: 'BASIC',
      lunesLiquidity: '10000',
      tokenLiquidity: '1000000',
    });

    expect(prismaMock.tokenListing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ListingStatus.PENDING,
          tokenAddress: '5TokenAddress',
        }),
        include: { liquidityLock: true },
      }),
    );
    expect(
      prismaMock.tokenListing.create.mock.calls[0][0].data.liquidityLock,
    ).toBeUndefined();
  });

  it('rejects activation without finalized on-chain proof fields', async () => {
    await expect(
      activateListing('listing-1', {
        onChainListingId: 7,
        onChainLockId: 11,
        pairAddress: '',
        lpTokenAddress: '5LpToken',
        lpAmount: '10',
        txHash: '0xabc12345',
      }),
    ).rejects.toThrow('On-chain listing proof is required before activation');
  });

  it('creates a real locked liquidity row only during proof-backed activation', async () => {
    prismaMock.tokenListing.findUnique.mockResolvedValue({
      id: 'listing-1',
      ownerAddress: '5OwnerAddress',
      tokenAddress: '5TokenAddress',
      tokenName: 'Token',
      tokenSymbol: 'TOK',
      tokenDecimals: 12,
      tier: ListingTier.BASIC,
      status: ListingStatus.PENDING,
      lunesLiquidity: '10000',
      tokenLiquidity: '1000000',
      liquidityLock: null,
      logoURI: null,
    });

    await activateListing('listing-1', {
      onChainListingId: 7,
      onChainLockId: 11,
      pairAddress: '5PairAddress',
      lpTokenAddress: '5LpTokenAddress',
      lpAmount: '123.45',
      txHash: '0xfinalizedtx',
    });

    expect(prismaMock.tokenListing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ListingStatus.ACTIVE,
          onChainListingId: 7,
          pairAddress: '5PairAddress',
          lpAmount: '123.45',
          txHash: '0xfinalizedtx',
        }),
      }),
    );
    expect(prismaMock.liquidityLock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          listingId: 'listing-1',
          ownerAddress: '5OwnerAddress',
          pairAddress: '5PairAddress',
          lpTokenAddress: '5LpTokenAddress',
          lpAmount: '123.45',
          status: 'LOCKED',
          onChainLockId: 11,
          txHashLock: '0xfinalizedtx',
        }),
      }),
    );
  });
});
