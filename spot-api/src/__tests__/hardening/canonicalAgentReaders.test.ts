/**
 * M-09 (third pass) — orders are now stored under the canonical maker, while
 * agents (and legacy rows) may hold prefix 57, prefix 0 or hex strings. Every
 * reader must see BOTH the canonical rows and the legacy raw rows of the same
 * account: risk gate (open-order cap), agent order list / portfolio, the
 * shared getUserOrders and the balance `locked` computation.
 */
import { Decimal } from '@prisma/client/runtime/library';

type StringFilter = string | { in: string[] } | undefined;
type OrderRow = {
  id: string;
  makerAddress: string;
  status: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: Decimal;
  stopPrice: Decimal | null;
  remainingAmount: Decimal;
  expiresAt: Date | null;
  createdAt: Date;
  pair: typeof PAIR;
};
type TradeRow = {
  id: string;
  makerAddress: string;
  takerAddress: string;
  side: 'BUY' | 'SELL';
  price: Decimal;
  amount: Decimal;
  settlementStatus: string;
  pairId: string;
  createdAt: Date;
  pair: typeof PAIR;
};
type BalanceRow = {
  address: string;
  token: string;
  available: Decimal;
  locked: Decimal;
};

const PAIR = {
  id: 'pair-1',
  symbol: 'LUNES/USDT',
  baseToken: 'base-token',
  quoteToken: 'quote-token',
  baseDecimals: 8,
  quoteDecimals: 8,
  isNativeBase: false,
  isNativeQuote: false,
  makerFeeBps: 0,
  takerFeeBps: 0,
};

const orders: OrderRow[] = [];
const trades: TradeRow[] = [];
const balances: BalanceRow[] = [];
const agentRows: Array<Record<string, unknown>> = [];

function matches(value: string, filter: StringFilter) {
  if (filter === undefined) return true;
  if (typeof filter === 'string') return value === filter;
  return filter.in.includes(value);
}

type OrderWhere = {
  makerAddress?: StringFilter;
  status?: StringFilter;
};
function orderMatches(row: OrderRow, where: OrderWhere = {}) {
  return (
    matches(row.makerAddress, where.makerAddress) &&
    matches(row.status, where.status)
  );
}

type TradeWhere = {
  settlementStatus?: StringFilter;
  OR?: Array<{ makerAddress?: StringFilter; takerAddress?: StringFilter }>;
};
function tradeMatches(row: TradeRow, where: TradeWhere = {}) {
  return (
    matches(row.settlementStatus, where.settlementStatus) &&
    (!where.OR ||
      where.OR.some(
        (branch) =>
          (branch.makerAddress !== undefined &&
            matches(row.makerAddress, branch.makerAddress)) ||
          (branch.takerAddress !== undefined &&
            matches(row.takerAddress, branch.takerAddress)),
      ))
  );
}

const mockPrisma = {
  agent: {
    findUnique: jest.fn(
      async ({ where }: { where: { id: string } }) =>
        agentRows.find((row) => row.id === where.id) ?? null,
    ),
  },
  executionLog: { count: jest.fn(async () => 0) },
  order: {
    findMany: jest.fn(async ({ where }: { where?: OrderWhere }) =>
      orders.filter((row) => orderMatches(row, where)),
    ),
    count: jest.fn(
      async ({ where }: { where?: OrderWhere }) =>
        orders.filter((row) => orderMatches(row, where)).length,
    ),
  },
  trade: {
    findMany: jest.fn(async ({ where }: { where?: TradeWhere }) =>
      trades.filter((row) => tradeMatches(row, where)),
    ),
  },
  userBalance: {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: { address?: StringFilter; token?: string };
      }) =>
        balances.filter(
          (row) =>
            matches(row.address, where.address) &&
            (where.token === undefined || row.token === where.token),
        ),
    ),
  },
  pair: { findMany: jest.fn(async () => [PAIR]) },
};

const mockSettlement = {
  isEnabled: jest.fn(() => false),
  getVaultBalance: jest.fn(async () => 1_000_000_000_000n),
  isNonceUsed: jest.fn(async () => null),
  isNonceCancelled: jest.fn(async () => null),
  cancelOrderFor: jest.fn(async () => null),
};

let currentAgentWallet = '';

jest.mock('../../db', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../services/settlementService', () => ({
  settlementService: mockSettlement,
}));
jest.mock('../../utils/orderbook', () => ({
  orderbookManager: { getOrCreate: jest.fn(), get: jest.fn() },
}));
jest.mock('../../services/tradeService', () => ({
  tradeService: { processMatches: jest.fn() },
}));
jest.mock('../../services/walletRiskService', () => ({
  walletRiskService: { assertWalletCanAct: jest.fn() },
}));
jest.mock('../../services/matchingLockService', () => ({
  withMatchingLock: jest.fn(async (_key: string, fn: () => unknown) => fn()),
}));
jest.mock('../../services/orderbookBootstrapService', () => ({
  rehydrateOrderbookForPair: jest.fn(async () => ({ restoredOrders: 0 })),
}));
jest.mock('../../services/copytradeService', () => ({
  copytradeService: { createSignal: jest.fn() },
}));
jest.mock('../../services/botSandbox', () => ({
  botRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  botAnomalyGuard: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  keyRotationWarning: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  recordLargeOrderPlaced: jest.fn(),
  recordOrderCancelled: jest.fn(),
}));
jest.mock('../../middleware/agentAuth', () => ({
  agentAuth:
    () =>
    (req: { agent?: unknown }, _res: unknown, next: () => void): void => {
      req.agent = {
        id: 'agent-1',
        walletAddress: currentAgentWallet,
        agentType: 'AI_AGENT',
        permissions: ['TRADE_SPOT'],
        keyId: 'key-1',
        stakingTier: 0,
        dailyTradeLimit: 10,
        maxPositionSize: 100,
        maxOpenOrders: 2,
      };
      next();
    },
}));

import express from 'express';
import request from 'supertest';
import { u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import tradeApiRouter from '../../routes/tradeApi';
import { executionLayerService } from '../../services/executionLayerService';
import { orderService } from '../../services/orderService';
import { getBalances } from '../../services/balanceService';

const app = express();
app.use(express.json());
app.use('/api/v1/trade', tradeApiRouter);

const GENERIC = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const PUBLIC_KEY = decodeAddress(GENERIC);
const HEX = u8aToHex(PUBLIC_KEY);
const ENCODINGS: Array<[string, string]> = [
  ['prefix 57', encodeAddress(PUBLIC_KEY, 57)],
  ['prefix 0', encodeAddress(PUBLIC_KEY, 0)],
  ['lower-case hex', HEX],
  ['upper-case hex', `0x${HEX.slice(2).toUpperCase()}`],
];
const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

function order(id: string, makerAddress: string, side: 'BUY' | 'SELL') {
  orders.push({
    id,
    makerAddress,
    status: 'OPEN',
    side,
    type: 'LIMIT',
    price: new Decimal('2'),
    stopPrice: null,
    remainingAmount: new Decimal('10'),
    expiresAt: null,
    createdAt: new Date(),
    pair: PAIR,
  });
}

function trade(id: string, makerAddress: string, takerAddress: string) {
  trades.push({
    id,
    makerAddress,
    takerAddress,
    side: 'BUY', // taker buys → maker is the seller
    price: new Decimal('2'),
    amount: new Decimal('5'),
    settlementStatus: 'PENDING',
    pairId: PAIR.id,
    createdAt: new Date(),
    pair: PAIR,
  });
}

/** Agent stored as `stored`; one post-fix canonical row + one legacy row. */
function seed(stored: string) {
  currentAgentWallet = stored;
  agentRows.push({
    id: 'agent-1',
    walletAddress: stored,
    isActive: true,
    isBanned: false,
    banReason: null,
    dailyTradeLimit: 10,
    maxPositionSize: '100',
    maxOpenOrders: 2,
    stakingTier: 0,
  });
  order('o-canonical', GENERIC, 'SELL');
  order('o-legacy', stored, 'SELL');
  order('o-other', OTHER, 'SELL');
  trade('t-canonical', GENERIC, OTHER);
  trade('t-legacy', stored, OTHER);
  trade('t-other', OTHER, OTHER);
  balances.push({
    address: GENERIC,
    token: 'base-token',
    available: new Decimal('30'),
    locked: new Decimal('0'),
  });
  balances.push({
    address: stored,
    token: 'base-token',
    available: new Decimal('20'),
    locked: new Decimal('0'),
  });
}

beforeEach(() => {
  orders.length = 0;
  trades.length = 0;
  balances.length = 0;
  agentRows.length = 0;
  jest.clearAllMocks();
  mockSettlement.isEnabled.mockReturnValue(false);
});

describe.each(ENCODINGS)('agent stored as %s', (_label, stored) => {
  it('open-order cap counts canonical and legacy rows', async () => {
    seed(stored);
    const result = await executionLayerService.validateTrade({
      agentId: 'agent-1',
      pairSymbol: 'LUNES/USDT',
      side: 'BUY',
      orderType: 'LIMIT',
      amount: '1',
      price: '1',
    });
    expect(result.checks.open_orders).toMatchObject({
      value: 2,
      limit: 2,
      passed: false,
    });
    expect(result.allowed).toBe(false);
  });

  it('GET /trade/orders lists canonical and legacy rows only', async () => {
    seed(stored);
    const res = await request(app).get('/api/v1/trade/orders');
    expect(res.status).toBe(200);
    expect(res.body.orders.map((row: { id: string }) => row.id).sort()).toEqual(
      ['o-canonical', 'o-legacy'],
    );
  });

  it('GET /trade/portfolio counts orders, trades and balances of the account', async () => {
    seed(stored);
    const res = await request(app).get('/api/v1/trade/portfolio');
    expect(res.status).toBe(200);
    expect(res.body.openOrders).toBe(2);
    expect(
      res.body.recentTrades.map((row: { id: string }) => row.id).sort(),
    ).toEqual(['t-canonical', 't-legacy']);
    expect(res.body.balances).toEqual([
      { token: 'base-token', available: 50, locked: 0 },
    ]);
  });

  it('getBalances sees resting orders in any encoding (ledger mode)', async () => {
    // The caller presents its own encoding: raw rows + canonical rows.
    seed(stored);
    const [row] = await getBalances(stored, 'base-token');
    expect(row).toEqual({
      token: 'base-token',
      total: '50',
      locked: '20',
      available: '30',
    });
  });

  it('getBalances locks unsettled trades in any encoding (settlement mode)', async () => {
    seed(stored);
    orders.length = 0;
    mockSettlement.isEnabled.mockReturnValue(true);
    const [row] = await getBalances(stored, 'base-token');
    // Seller of t-canonical and t-legacy: 5 + 5 base locked.
    expect(row.locked).toBe('10');
  });
});

describe('canonical lookups see legacy prefix-57 rows', () => {
  it('getBalances(42) counts an order stored in 57', async () => {
    seed(ENCODINGS[0][1]);
    const [row] = await getBalances(GENERIC, 'base-token');
    expect(row).toMatchObject({ total: '50', locked: '20' });
  });
});

describe('getUserOrders (every caller)', () => {
  it('a canonical lookup also returns legacy rows of the same account', async () => {
    seed(ENCODINGS[0][1]);
    const rows = await orderService.getUserOrders(GENERIC);
    expect(rows.map((row) => row.id).sort()).toEqual([
      'o-canonical',
      'o-legacy',
    ]);
  });

  it('an undecodable maker is still an exact-string lookup', async () => {
    order('o-raw', 'legacy-raw', 'BUY');
    order('o-canonical', GENERIC, 'BUY');
    const rows = await orderService.getUserOrders('legacy-raw');
    expect(rows.map((row) => row.id)).toEqual(['o-raw']);
  });
});
