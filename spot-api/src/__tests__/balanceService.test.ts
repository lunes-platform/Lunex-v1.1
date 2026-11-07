const mockPrisma = {
  userBalance: { findMany: jest.fn() },
  order: { findMany: jest.fn() },
  pair: { findMany: jest.fn() },
  trade: { findMany: jest.fn() },
};
const mockSettlement = { isEnabled: jest.fn(), getVaultBalance: jest.fn() };
jest.mock('../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../services/settlementService', () => ({
  settlementService: mockSettlement,
}));
import { getBalances } from '../services/balanceService';
const native = '0x' + '00'.repeat(32);
const pair = {
  id: 'p',
  symbol: 'QAX/QUSD',
  baseToken: 'base',
  quoteToken: 'quote',
  baseDecimals: 8,
  quoteDecimals: 6,
  makerFeeBps: 10,
  takerFeeBps: 25,
  isNativeBase: false,
  isNativeQuote: false,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockSettlement.isEnabled.mockReturnValue(true);
  mockPrisma.order.findMany.mockResolvedValue([]);
  mockPrisma.trade.findMany.mockResolvedValue([]);
  mockPrisma.userBalance.findMany.mockResolvedValue([
    { token: 'quote', available: '999999', locked: '0' },
  ]);
  mockPrisma.pair.findMany.mockResolvedValue([pair]);
  mockSettlement.getVaultBalance.mockImplementation(
    async (_user, token, isNative) =>
      isNative ? 200000000n : token === 'base' ? 50000000000n : 5000000000n,
  );
});
it('uses actual funded vault totals rather than an empty/stale off-chain ledger', async () => {
  const rows = await getBalances('wallet');
  expect(rows).toEqual([
    { token: 'base', total: '500', locked: '0', available: '500' },
    { token: 'quote', total: '5000', locked: '0', available: '5000' },
  ]);
  expect(mockPrisma.userBalance.findMany).not.toHaveBeenCalled();
});
it('reserves the maximum buyer fee and releases the reservation after cancel', async () => {
  mockPrisma.order.findMany.mockResolvedValue([
    {
      side: 'BUY',
      type: 'LIMIT',
      price: '2',
      stopPrice: null,
      remainingAmount: '1',
      pair,
    },
  ]);
  expect((await getBalances('wallet', 'quote'))[0]).toEqual({
    token: 'quote',
    total: '5000',
    locked: '2.005',
    available: '4997.995',
  });
  mockPrisma.order.findMany.mockResolvedValue([]);
  expect((await getBalances('wallet', 'quote'))[0].available).toBe('5000');
});
it('separates native and wrapped assets even when Pair.baseToken is the same', async () => {
  mockPrisma.pair.findMany.mockResolvedValue([
    pair,
    { ...pair, id: 'native', symbol: 'LUNES/QUSD', isNativeBase: true },
  ]);
  mockPrisma.order.findMany.mockResolvedValue([
    {
      side: 'SELL',
      type: 'LIMIT',
      price: '2',
      remainingAmount: '0.1',
      pair: { ...pair, isNativeBase: true },
    },
  ]);
  const rows = await getBalances('wallet');
  expect(rows.find((b) => b.token === native)).toEqual({
    token: native,
    total: '2',
    locked: '0.1',
    available: '1.9',
  });
  expect(rows.find((b) => b.token === 'base')?.locked).toBe('0');
});
it('fails instead of replacing an unavailable vault query with a ledger or zero', async () => {
  mockSettlement.getVaultBalance.mockResolvedValue(null);
  await expect(getBalances('wallet')).rejects.toThrow('unavailable');
});

// ─── Unsettled trades (matched off-chain, not yet debited on-chain) ───
// A filled order stops reserving funds, but the vault is only debited when
// settle_trade finalizes. Until then the fill must stay locked, otherwise the
// same vault balance could back a second order whose settlement then fails.
it('locks the base of a filled-but-unsettled SELL until settlement', async () => {
  mockPrisma.trade.findMany.mockResolvedValue([
    {
      side: 'BUY', // taker buys → maker ('wallet') is the seller
      makerAddress: 'wallet',
      takerAddress: 'other',
      price: '2',
      amount: '100',
      pair,
    },
  ]);
  expect((await getBalances('wallet', 'base'))[0]).toEqual({
    token: 'base',
    total: '500',
    locked: '100',
    available: '400',
  });
  expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        settlementStatus: {
          in: ['PENDING', 'SETTLING', 'FAILED', 'RECONCILE_REQUIRED'],
        },
        OR: [{ makerAddress: 'wallet' }, { takerAddress: 'wallet' }],
      },
    }),
  );
});
it('locks quote + max fee for the buyer side of an unsettled trade', async () => {
  mockPrisma.trade.findMany.mockResolvedValue([
    {
      side: 'SELL', // taker sells → maker ('wallet') is the buyer
      makerAddress: 'wallet',
      takerAddress: 'other',
      price: '2',
      amount: '1',
      pair,
    },
  ]);
  const rows = await getBalances('wallet');
  expect(rows.find((b) => b.token === 'quote')?.locked).toBe('2.005');
  // The base the buyer will receive is NOT counted until it settles.
  expect(rows.find((b) => b.token === 'base')?.available).toBe('500');
});
it('does not consult unsettled trades when on-chain settlement is disabled', async () => {
  mockSettlement.isEnabled.mockReturnValue(false);
  await getBalances('wallet');
  expect(mockPrisma.trade.findMany).not.toHaveBeenCalled();
});
