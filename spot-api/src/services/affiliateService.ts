import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../db';

// Aggressive model: 4% → 3% → 1.5% → 1% → 0.5%
const AFFILIATE_RATES_BPS = [400, 300, 150, 100, 50];
const MAX_LEVELS = 5;
const BPS_DENOMINATOR = 10000;
const PAYOUT_INTERVAL_DAYS = 7;
const COMMISSION_ACTIVATION_COOLDOWN_DAYS = 7; // referral must be ≥7 days old to earn commissions

function generateCode(address: string): string {
  const hash = crypto.createHash('sha256').update(address).digest('hex');
  return hash.substring(0, 8).toUpperCase();
}

// ─── Prisma result shapes ─────────────────────────────────────────

type GroupByEarning = {
  level: number;
  feeToken: string;
  _sum: { commissionAmount: Decimal | null };
  _count: number | Record<string, number>;
};

type CommissionRow = {
  id: string;
  level: number;
  feeToken: string;
  commissionAmount: Decimal;
  sourceType: string;
  batchId: string | null;
  batch?: { processedAt: Date | null } | null;
  createdAt: Date;
};

export const affiliateService = {
  /**
   * Get or generate a referral code for an address
   */
  async getOrCreateReferralCode(address: string): Promise<string> {
    const existing = await prisma.referral.findFirst({
      where: { referrerAddress: address },
      select: { referralCode: true },
    });
    if (existing) return existing.referralCode;

    return generateCode(address);
  },

  /**
   * Register a new referral. Links refereeAddress to the owner of the referralCode.
   */
  async registerReferral(refereeAddress: string, referralCode: string) {
    const alreadyReferred = await prisma.referral.findUnique({
      where: { refereeAddress },
    });
    if (alreadyReferred) {
      throw new Error('Address already has a referrer');
    }

    // Find the referrer — look for someone whose code matches
    const referrerRef = await prisma.referral.findFirst({
      where: { referralCode },
      select: { referrerAddress: true },
    });

    const resolvedReferrer =
      referrerRef?.referrerAddress ?? `code:${referralCode}`;

    // Block self-referral: referee cannot be the same wallet as the referrer
    if (
      referrerRef &&
      refereeAddress.toLowerCase() === resolvedReferrer.toLowerCase()
    ) {
      throw new Error('Self-referral is not allowed');
    }

    // Block circular referral: check if refereeAddress already exists as a referrer
    // of the resolvedReferrer anywhere in the chain (up to MAX_LEVELS deep)
    if (referrerRef) {
      const chain = await this.getReferralChain(resolvedReferrer);
      const inChain = chain.some(
        (node) => node.address.toLowerCase() === refereeAddress.toLowerCase(),
      );
      if (inChain) {
        throw new Error('Circular referral chain is not allowed');
      }
    }

    const referralData = {
      referrerAddress: resolvedReferrer,
      refereeAddress,
      referralCode,
      level: 1,
    };

    const referral = await prisma.referral.create({ data: referralData });
    return referral;
  },

  /**
   * Walk up the referral chain from a given address, returning ancestors up to MAX_LEVELS.
   * Uses a single loop with sequential findUnique — max 5 queries total (bounded depth).
   */
  async getReferralChain(address: string) {
    const chain: { address: string; level: number }[] = [];
    let currentAddress = address;

    for (let level = 1; level <= MAX_LEVELS; level++) {
      const referral = await prisma.referral.findUnique({
        where: { refereeAddress: currentAddress },
      });
      if (!referral) break;
      chain.push({ address: referral.referrerAddress, level });
      currentAddress = referral.referrerAddress;
    }

    return chain;
  },

  /**
   * Core hook: distribute affiliate commissions from a fee event.
   * Called after a trade/margin/copytrade fee is collected.
   */
  async distributeCommissions(
    sourceAddr: string,
    feeToken: string,
    feeAmount: number | string,
    sourceType: 'SPOT' | 'MARGIN' | 'COPYTRADE',
    sourceTradeId?: string,
  ) {
    const fee =
      typeof feeAmount === 'string' ? parseFloat(feeAmount) : feeAmount;
    if (fee <= 0) return [];

    const chain = await this.getReferralChain(sourceAddr);
    if (chain.length === 0) return [];

    // Anti-farming cooldown: only distribute if the referral is ≥7 days old
    const referral = await prisma.referral.findUnique({
      where: { refereeAddress: sourceAddr },
      select: { createdAt: true },
    });
    if (referral) {
      const ageMs = Date.now() - referral.createdAt.getTime();
      const cooldownMs =
        COMMISSION_ACTIVATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs < cooldownMs) return []; // referral too new — skip commissions
    }

    const commissions = [];

    for (const ancestor of chain) {
      const rateBps = AFFILIATE_RATES_BPS[ancestor.level - 1];
      if (!rateBps) break;

      const commissionAmount = (fee * rateBps) / BPS_DENOMINATOR;
      if (commissionAmount <= 0) continue;

      const commission = await prisma.affiliateCommission.create({
        data: {
          beneficiaryAddr: ancestor.address,
          sourceAddr,
          sourceTradeId,
          sourceType,
          level: ancestor.level,
          feeToken,
          feeAmount: new Decimal(fee.toString()),
          commissionRate: rateBps,
          commissionAmount: new Decimal(commissionAmount.toString()),
          isPaid: false,
        },
      });

      commissions.push(commission);
    }

    return commissions;
  },

  /**
   * Dashboard: aggregate earnings for an affiliate
   */
  async getDashboard(address: string) {
    const [earningsByLevel, unpaid, paid, directReferrals, referralCode] =
      await Promise.all([
        prisma.affiliateCommission.groupBy({
          by: ['level', 'feeToken'],
          where: { beneficiaryAddr: address },
          _sum: { commissionAmount: true },
          _count: true,
        }),
        prisma.affiliateCommission.aggregate({
          where: { beneficiaryAddr: address, isPaid: false },
          _sum: { commissionAmount: true },
          _count: true,
        }),
        prisma.affiliateCommission.aggregate({
          where: { beneficiaryAddr: address, isPaid: true },
          _sum: { commissionAmount: true },
          _count: true,
        }),
        prisma.referral.count({ where: { referrerAddress: address } }),
        this.getOrCreateReferralCode(address),
      ]);

    return {
      referralCode,
      directReferrals,
      earningsByLevel: (earningsByLevel as GroupByEarning[]).map((e) => ({
        level: e.level,
        token: e.feeToken,
        totalEarned: parseFloat(e._sum.commissionAmount?.toString() || '0'),
        tradeCount: typeof e._count === 'number' ? e._count : 0,
      })),
      totalUnpaid: parseFloat(unpaid._sum.commissionAmount?.toString() || '0'),
      unpaidCount: unpaid._count,
      totalPaid: parseFloat(paid._sum.commissionAmount?.toString() || '0'),
      paidCount: paid._count,
      levels: AFFILIATE_RATES_BPS.map((rate, i) => ({
        level: i + 1,
        ratePct: rate / 100,
        rateBps: rate,
      })),
    };
  },

  /**
   * Referral tree: get downstream referees for an address.
   *
   * B1 FIX: Instead of 2 queries per referee in a loop (N+1),
   * we batch-fetch all counts and earnings in a single groupBy + aggregate
   * at each depth level before building the node list.
   */
  async getReferralTree(address: string, maxDepth = 3) {
    return this._buildTreeBatched(address, 1, maxDepth);
  },

  async _buildTreeBatched(
    address: string,
    currentDepth: number,
    maxDepth: number,
  ): Promise<unknown[]> {
    if (currentDepth > maxDepth) return [];

    const directs = await prisma.referral.findMany({
      where: { referrerAddress: address },
      select: { refereeAddress: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (directs.length === 0) return [];

    const refereeAddresses = directs.map((d) => d.refereeAddress);

    // B1 FIX: Batch all counts and earnings in 2 queries instead of 2×N
    const [subCountsRaw, earningsRaw] = await Promise.all([
      prisma.referral.groupBy({
        by: ['referrerAddress'],
        where: { referrerAddress: { in: refereeAddresses } },
        _count: { id: true },
      }),
      prisma.affiliateCommission.groupBy({
        by: ['sourceAddr'],
        where: { sourceAddr: { in: refereeAddresses } },
        _sum: { commissionAmount: true },
      }),
    ]);

    const subCountMap = new Map(
      subCountsRaw.map((r) => [r.referrerAddress, r._count.id]),
    );
    const earningsMap = new Map(
      earningsRaw.map((r) => [r.sourceAddr, r._sum.commissionAmount]),
    );

    const childrenResults =
      currentDepth < maxDepth
        ? await Promise.all(
            refereeAddresses.map((addr) =>
              this._buildTreeBatched(addr, currentDepth + 1, maxDepth),
            ),
          )
        : refereeAddresses.map(() => []);

    return directs.map((ref, i) => ({
      address: ref.refereeAddress,
      joinedAt: ref.createdAt,
      level: currentDepth,
      subReferrals: subCountMap.get(ref.refereeAddress) ?? 0,
      totalFeeGenerated: parseFloat(
        earningsMap.get(ref.refereeAddress)?.toString() || '0',
      ),
      children: childrenResults[i],
    }));
  },

  /**
   * Payout history: list completed commissions for an address
   */
  async getPayoutHistory(address: string, limit = 20) {
    const commissions = await prisma.affiliateCommission.findMany({
      where: { beneficiaryAddr: address, isPaid: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { batch: true },
    });

    return (commissions as CommissionRow[]).map((c) => ({
      id: c.id,
      level: c.level,
      token: c.feeToken,
      amount: parseFloat(c.commissionAmount.toString()),
      sourceType: c.sourceType,
      paidAt: c.batch?.processedAt || c.createdAt,
      batchId: c.batchId,
    }));
  },

  /**
   * Process payout batch — mark unpaid commissions as paid.
   * Called by a cron job every 7 days.
   */
  async processPayoutBatch() {
    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(
      now.getTime() - PAYOUT_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
    );

    const batch = await prisma.affiliatePayoutBatch.create({
      data: { periodStart, periodEnd, status: 'PROCESSING' },
    });

    try {
      const unpaid = await prisma.affiliateCommission.findMany({
        where: { isPaid: false, createdAt: { lte: periodEnd } },
      });

      if (unpaid.length === 0) {
        await prisma.affiliatePayoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'COMPLETED',
            processedAt: now,
            totalPaid: new Decimal('0'),
          },
        });
        return { batchId: batch.id, processed: 0, totalPaid: 0 };
      }

      let totalPaid = new Decimal('0');

      // Batch the updates in a single transaction instead of per-loop awaits
      await prisma.$transaction(
        unpaid.map((commission) =>
          prisma.affiliateCommission.update({
            where: { id: commission.id },
            data: { isPaid: true, batchId: batch.id },
          }),
        ),
      );

      for (const commission of unpaid) {
        totalPaid = totalPaid.plus(commission.commissionAmount);
      }

      await prisma.affiliatePayoutBatch.update({
        where: { id: batch.id },
        data: { status: 'COMPLETED', processedAt: now, totalPaid },
      });

      return {
        batchId: batch.id,
        processed: unpaid.length,
        totalPaid: parseFloat(totalPaid.toString()),
      };
    } catch (error) {
      await prisma.affiliatePayoutBatch.update({
        where: { id: batch.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  },
};
