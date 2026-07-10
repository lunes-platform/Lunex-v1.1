import { NextFunction, Router, Request, Response } from 'express';
import prisma from '../db';
import { orderbookManager } from '../utils/orderbook';
import { factoryService } from '../services/factoryService';
import { config } from '../config';
import { log } from '../utils/logger';
import { requireAdmin } from '../middleware/adminGuard';
import { withTxTimeout, TxTimeoutError } from '../utils/txWithTimeout';

const router = Router();

// Hard bound for ticker DB work so the endpoint never hangs the /spot header.
// Aggregation over a high-volume 24h window is computed in-DB (not in Node);
// when the DB is healthy this resolves well under 1s. If the host is heavily
// contended (e.g. a volume burst saturating CPU) we bail out at this bound and
// return a coherent zero/null payload (HTTP 200, degraded:true) instead of
// leaving the request — and the market header — pending indefinitely.
const TICKER_DB_TIMEOUT_MS = 3_000;

const toNum = (v: unknown): number =>
  v == null ? 0 : parseFloat(v.toString());

// ─── Public routes ───────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pairs = await prisma.pair.findMany({
      where: { isActive: true },
      orderBy: { symbol: 'asc' },
    });
    res.json({ pairs });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:symbol/ticker',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { symbol } = req.params;
      const pair = await prisma.pair.findUnique({ where: { symbol } });
      if (!pair) return res.status(404).json({ error: 'Pair not found' });

      const since = new Date(Date.now() - 86_400_000);
      const where = { pairId: pair.id, createdAt: { gte: since } };
      const book = orderbookManager.get(symbol);

      let lastPrice = 0;
      let firstPrice = 0;
      let high24h = 0;
      let low24h = 0;
      let volume24h = 0;
      let quoteVolume24h = 0;
      let tradeCount = 0;
      let degraded = false;

      // Compute 24h stats in the database instead of pulling every trade row
      // into Node (a high-volume window can be tens of thousands of rows, which
      // previously hung the request and stalled the /spot market header).
      try {
        const [agg, newest, oldest] = await withTxTimeout(
          'ticker-24h-stats',
          Promise.all([
            prisma.trade.aggregate({
              where,
              _count: { _all: true },
              _max: { price: true },
              _min: { price: true },
              _sum: { amount: true, quoteAmount: true },
            }),
            prisma.trade.findFirst({
              where,
              orderBy: { createdAt: 'desc' },
              select: { price: true },
            }),
            prisma.trade.findFirst({
              where,
              orderBy: { createdAt: 'asc' },
              select: { price: true },
            }),
          ]),
          TICKER_DB_TIMEOUT_MS,
        );

        tradeCount = agg._count?._all ?? 0;
        high24h = toNum(agg._max?.price);
        low24h = toNum(agg._min?.price);
        volume24h = toNum(agg._sum?.amount);
        quoteVolume24h = toNum(agg._sum?.quoteAmount);
        lastPrice = toNum(newest?.price);
        firstPrice = toNum(oldest?.price);
      } catch (err) {
        // Never hang the header: on slow/contended DB, return a coherent
        // zero payload (HTTP 200) and flag it as degraded.
        if (err instanceof TxTimeoutError) {
          degraded = true;
          log.warn(
            { symbol, timeoutMs: TICKER_DB_TIMEOUT_MS },
            '[Pairs] Ticker 24h stats timed out — returning degraded payload',
          );
        } else {
          throw err;
        }
      }

      const change24h =
        firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

      res.json({
        symbol: pair.symbol,
        lastPrice,
        high24h,
        low24h,
        volume24h,
        quoteVolume24h,
        change24h: parseFloat(change24h.toFixed(2)),
        tradeCount,
        bestBid: book?.getBestBid() ?? null,
        bestAsk: book?.getBestAsk() ?? null,
        spread: book?.getSpread() ?? null,
        degraded,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Admin routes ────────────────────────────────────────────────

router.get(
  '/on-chain',
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.blockchain.factoryContractAddress) {
        return res.status(503).json({
          error:
            'FACTORY_CONTRACT_ADDRESS not set. On-chain discovery unavailable.',
        });
      }
      const [length, pairs] = await Promise.all([
        factoryService.getAllPairsLength(),
        factoryService.getAllPairs(),
      ]);
      res.json({ totalOnChain: length, pairs });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/register',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        symbol,
        baseToken,
        quoteToken,
        baseName,
        quoteName,
        baseDecimals = 8,
        quoteDecimals = 8,
        isNativeBase = false,
        isNativeQuote = false,
        makerFeeBps = 10,
        takerFeeBps = 25,
      } = req.body;

      if (!symbol || !baseToken || !quoteToken || !baseName || !quoteName) {
        return res.status(400).json({
          error:
            'Missing required fields: symbol, baseToken, quoteToken, baseName, quoteName',
        });
      }

      const existing = await prisma.pair.findUnique({ where: { symbol } });
      if (existing) {
        return res.status(409).json({
          error: `Pair "${symbol}" is already registered`,
          pair: existing,
        });
      }

      let pairAddress: string | null = null;
      if (config.blockchain.factoryContractAddress) {
        pairAddress = await factoryService.getPair(baseToken, quoteToken);
        if (!pairAddress) {
          return res.status(400).json({
            error: `Pair (${baseToken} / ${quoteToken}) not found on-chain. Call factory.create_pair first.`,
            hint: 'Use polkadot.js apps or the Lunex admin CLI to call create_pair on the Factory contract.',
          });
        }
        log.info({ pairAddress }, '[Pairs] On-chain validation passed');
      } else {
        if (config.isProd) {
          return res.status(503).json({
            error:
              'FACTORY_CONTRACT_ADDRESS not configured. Refusing to register pair without on-chain validation.',
          });
        }
        log.warn(
          '[Pairs] FACTORY_CONTRACT_ADDRESS not set — skipping on-chain validation',
        );
      }

      const pair = await prisma.pair.create({
        data: {
          symbol,
          baseToken,
          quoteToken,
          pairAddress,
          baseName,
          quoteName,
          baseDecimals,
          quoteDecimals,
          isNativeBase,
          isNativeQuote,
          makerFeeBps,
          takerFeeBps,
          isActive: true,
        },
      });

      log.info(
        { symbol, pairAddress: pairAddress ?? 'N/A' },
        '[Pairs] Registered pair',
      );
      res.status(201).json({ pair });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/:symbol/sync',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { symbol } = req.params;
      const pair = await prisma.pair.findUnique({ where: { symbol } });
      if (!pair) return res.status(404).json({ error: 'Pair not found' });

      if (!config.blockchain.factoryContractAddress) {
        return res
          .status(503)
          .json({ error: 'FACTORY_CONTRACT_ADDRESS not configured' });
      }

      const pairAddress = await factoryService.getPair(
        pair.baseToken,
        pair.quoteToken,
      );
      if (!pairAddress) {
        return res.status(400).json({
          error: `Pair not found on-chain for tokens (${pair.baseToken} / ${pair.quoteToken})`,
        });
      }

      const updated = await prisma.pair.update({
        where: { symbol },
        data: { pairAddress },
      });
      res.json({ pair: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/id/:id/status',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'isActive boolean is required' });
      }

      const pair = await prisma.pair.findUnique({ where: { id } });
      if (!pair) return res.status(404).json({ error: 'Pair not found' });

      const updated = await prisma.pair.update({
        where: { id },
        data: { isActive },
      });

      res.json({ pair: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/id/:id',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const pair = await prisma.pair.findUnique({ where: { id } });
      if (!pair) return res.status(404).json({ error: 'Pair not found' });

      const [tradeCount, openOrderCount] = await Promise.all([
        prisma.trade.count({ where: { pairId: id } }),
        prisma.order.count({
          where: { pairId: id, status: { in: ['OPEN', 'PARTIAL'] } },
        }),
      ]);

      if (tradeCount > 0) {
        return res.status(409).json({
          error: `Cannot delete pair with ${tradeCount} existing trades. Deactivate it instead.`,
        });
      }

      if (openOrderCount > 0) {
        return res.status(409).json({
          error: `Cannot delete pair with ${openOrderCount} open orders. Deactivate it instead.`,
        });
      }

      await prisma.pair.delete({ where: { id } });
      res.json({ deleted: true, pair });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
