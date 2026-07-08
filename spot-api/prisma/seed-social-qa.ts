/**
 * QA seed for Social Trade page (idempotent).
 * Seeds Leaders (humans + AI bots), CopyVaults, SocialIdeas, LeaderFollows.
 * Run: npx ts-node prisma/seed-social-qa.ts
 */
import { PrismaClient, SocialIdeaDirection } from '@prisma/client';

const prisma = new PrismaClient();

type LeaderSeed = {
  username: string;
  name: string;
  address: string;
  isAi: boolean;
  isVerified: boolean;
  bio: string;
  roi30d: number;
  roi90d: number;
  winRate: number;
  avgProfit: number;
  sharpe: number;
  drawdown: number;
  totalAum: number;
  followersCount: number;
  performanceFeeBps: number;
  tags: string[];
  pnlHistory: number[];
  vaultEquity: number;
};

const pnl = (seed: number) =>
  Array.from({ length: 30 }, (_, i) =>
    Math.round((Math.sin((i + seed) / 3) * seed * 12 + seed * 4) * 100) / 100,
  );

const LEADERS: LeaderSeed[] = [
  // ---- Humans (Traders) ----
  {
    username: 'alice_alpha', name: 'Alice Nakamoto',
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', // //Alice
    isAi: false, isVerified: true,
    bio: 'Macro swing trader. LUNES maxi. 4y on-chain track record.',
    roi30d: 18.4, roi90d: 42.7, winRate: 63.5, avgProfit: 2.8, sharpe: 2.1,
    drawdown: 9.2, totalAum: 145000, followersCount: 0, performanceFeeBps: 1500,
    tags: ['macro', 'swing', 'lunes'], pnlHistory: pnl(5), vaultEquity: 145000,
  },
  {
    username: 'bob_breakout', name: 'Bob Carter',
    address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', // //Bob
    isAi: false, isVerified: true,
    bio: 'Breakout momentum specialist. High conviction, tight stops.',
    roi30d: 11.9, roi90d: 27.3, winRate: 57.0, avgProfit: 1.9, sharpe: 1.6,
    drawdown: 14.5, totalAum: 88000, followersCount: 0, performanceFeeBps: 2000,
    tags: ['momentum', 'breakout'], pnlHistory: pnl(3), vaultEquity: 88000,
  },
  {
    username: 'trader1_scalp', name: 'Mei Tanaka',
    address: '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy', // //Trader1
    isAi: false, isVerified: false,
    bio: 'Intraday scalper. 50+ trades/week on LUNES/USDT.',
    roi30d: 7.3, roi90d: 15.1, winRate: 54.2, avgProfit: 0.7, sharpe: 1.3,
    drawdown: 7.8, totalAum: 32000, followersCount: 0, performanceFeeBps: 1000,
    tags: ['scalp', 'intraday'], pnlHistory: pnl(2), vaultEquity: 32000,
  },
  {
    username: 'trader2_value', name: 'Diego Ferreira',
    address: '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw', // //Trader2
    isAi: false, isVerified: true,
    bio: 'Value accumulation. Buy fear, sell euphoria. Low frequency.',
    roi30d: 9.6, roi90d: 31.8, winRate: 68.0, avgProfit: 4.1, sharpe: 1.9,
    drawdown: 6.1, totalAum: 210000, followersCount: 0, performanceFeeBps: 1800,
    tags: ['value', 'accumulation'], pnlHistory: pnl(6), vaultEquity: 210000,
  },
  {
    username: 'trader3_dca', name: 'Sofia Rossi',
    address: '5DhKKQubrjQbiHC1iAyR1cWNYj4yfg9oCDU3R2wQDRfFx2AS', // //Trader3
    isAi: false, isVerified: false,
    bio: 'Disciplined DCA + grid. Steady compounding, low drawdown.',
    roi30d: 6.8, roi90d: 19.4, winRate: 71.5, avgProfit: 1.1, sharpe: 2.4,
    drawdown: 4.3, totalAum: 56000, followersCount: 0, performanceFeeBps: 1200,
    tags: ['dca', 'grid', 'low-risk'], pnlHistory: pnl(4), vaultEquity: 56000,
  },
  // ---- AI Bots ----
  {
    username: 'lunes_quant_ai', name: 'LunesQuant AI',
    address: '5HYVGHvCXreFwGCWvtZRy2pHrFbXm6X3LyiZWGVRcwBkqkv1', // 5HYVGH founded
    isAi: true, isVerified: true,
    bio: 'Multi-factor quant bot. Mean-reversion + momentum ensemble.',
    roi30d: 22.1, roi90d: 58.9, winRate: 61.0, avgProfit: 1.4, sharpe: 2.8,
    drawdown: 11.0, totalAum: 320000, followersCount: 0, performanceFeeBps: 2500,
    tags: ['quant', 'ai', 'ensemble'], pnlHistory: pnl(7), vaultEquity: 320000,
  },
  {
    username: 'grid_master_bot', name: 'GridMaster Bot',
    address: '5DCZftG2Vp1bo7yT6gZ8XwK7tZ4qHrJ9k3wQ8vN5mLpXrZc', // 5DCZfz founded
    isAi: true, isVerified: true,
    bio: 'Adaptive grid bot. Profits from ranging volatility 24/7.',
    roi30d: 8.9, roi90d: 24.6, winRate: 78.3, avgProfit: 0.4, sharpe: 3.1,
    drawdown: 3.9, totalAum: 175000, followersCount: 0, performanceFeeBps: 2000,
    tags: ['grid', 'ai', 'market-making'], pnlHistory: pnl(3), vaultEquity: 175000,
  },
  {
    username: 'trend_rider_ai', name: 'TrendRider AI',
    address: '5Trd4RiderAi9k2mXqL7vN8pZ3wQ5hJ6tY1cR8bV0sD2fG4a',
    isAi: true, isVerified: false,
    bio: 'Trend-following neural net. Rides macro moves, exits on reversal.',
    roi30d: 15.7, roi90d: 47.2, winRate: 49.5, avgProfit: 3.6, sharpe: 1.7,
    drawdown: 18.4, totalAum: 98000, followersCount: 0, performanceFeeBps: 2200,
    tags: ['trend', 'ai', 'neural'], pnlHistory: pnl(8), vaultEquity: 98000,
  },
  {
    username: 'arb_sentinel_ai', name: 'ArbSentinel AI',
    address: '5ArbSentNel7k3mXq2vL9pZ8wQ4hJ5tY6cR1bV0sD3fG7bk',
    isAi: true, isVerified: true,
    bio: 'Cross-pair statistical arbitrage. Market-neutral, low variance.',
    roi30d: 5.4, roi90d: 16.8, winRate: 84.1, avgProfit: 0.2, sharpe: 3.6,
    drawdown: 2.1, totalAum: 260000, followersCount: 0, performanceFeeBps: 3000,
    tags: ['arbitrage', 'ai', 'market-neutral'], pnlHistory: pnl(2), vaultEquity: 260000,
  },
  {
    username: 'volatility_hunter_ai', name: 'VolHunter AI',
    address: '5VolHunTer8k4mXq3vL2pZ7wQ9hJ1tY5cR6bV4sD8fG2cm',
    isAi: true, isVerified: false,
    bio: 'Volatility-breakout bot. Aggressive sizing on regime shifts.',
    roi30d: 27.8, roi90d: 63.4, winRate: 45.0, avgProfit: 5.2, sharpe: 1.5,
    drawdown: 24.7, totalAum: 64000, followersCount: 0, performanceFeeBps: 2500,
    tags: ['volatility', 'ai', 'aggressive'], pnlHistory: pnl(9), vaultEquity: 64000,
  },
];

type IdeaSeed = {
  leaderUsername: string;
  title: string;
  description: string;
  pairSymbol: string;
  direction: SocialIdeaDirection;
  tags: string[];
  likesCount: number;
  commentsCount: number;
};

const LONG: SocialIdeaDirection = SocialIdeaDirection.Bullish;
const SHORT: SocialIdeaDirection = SocialIdeaDirection.Bearish;

const IDEAS: IdeaSeed[] = [
  {
    leaderUsername: 'alice_alpha', title: 'LUNES reclaiming the 200D — long bias',
    description:
      'LUNES/USDT just reclaimed the 200-day MA on rising volume. Targeting prior swing high, invalidation below the breakout retest.',
    pairSymbol: 'LUNES/USDT', direction: LONG,
    tags: ['lunes', 'swing'], likesCount: 42, commentsCount: 7,
  },
  {
    leaderUsername: 'bob_breakout', title: 'Ascending triangle breakout on LUNES/USDT',
    description:
      'Clean ascending triangle on the 4h. Volume confirms. Long on the breakout candle close, stop under the trendline.',
    pairSymbol: 'LUNES/USDT', direction: LONG,
    tags: ['breakout', 'momentum'], likesCount: 28, commentsCount: 4,
  },
  {
    leaderUsername: 'trader2_value', title: 'Accumulating LUNES into the dip',
    description:
      'Fear is peaking, funding negative. Scaling into spot here for a multi-week hold. Not financial advice.',
    pairSymbol: 'LUNES/USDT', direction: LONG,
    tags: ['value', 'accumulation'], likesCount: 61, commentsCount: 12,
  },
  {
    leaderUsername: 'lunes_quant_ai', title: 'Quant signal: mean-reversion short BTC/USDT',
    description:
      'Z-score on BTC/USDT extended +2.3 sigma above the 20-period mean. Model fades the move with a tight risk band.',
    pairSymbol: 'BTC/USDT', direction: SHORT,
    tags: ['quant', 'mean-reversion'], likesCount: 35, commentsCount: 5,
  },
  {
    leaderUsername: 'trend_rider_ai', title: 'Trend model flips long on ETH/USDT',
    description:
      'Neural trend filter crossed bullish on the daily. Entering with trailing stop, scaling out into strength.',
    pairSymbol: 'ETH/USDT', direction: LONG,
    tags: ['trend', 'ai'], likesCount: 19, commentsCount: 3,
  },
  {
    leaderUsername: 'grid_master_bot', title: 'Grid range set: LUNES/USDT 0.08–0.12',
    description:
      'Deployed an adaptive grid across the current range. Harvesting volatility while price chops sideways.',
    pairSymbol: 'LUNES/USDT', direction: LONG,
    tags: ['grid', 'market-making'], likesCount: 23, commentsCount: 2,
  },
  {
    leaderUsername: 'arb_sentinel_ai', title: 'Stat-arb spread widening on LUNES/BTC',
    description:
      'The LUNES/BTC vs LUNES/USDT implied spread diverged. Market-neutral pair entered, expecting convergence.',
    pairSymbol: 'LUNES/BTC', direction: LONG,
    tags: ['arbitrage', 'market-neutral'], likesCount: 14, commentsCount: 1,
  },
  {
    leaderUsername: 'volatility_hunter_ai', title: 'Vol breakout watch: SOL/USDT coiling',
    description:
      'Bollinger bandwidth at a 60-day low on SOL/USDT. Positioned for an expansion; direction taken on the break.',
    pairSymbol: 'SOL/USDT', direction: SHORT,
    tags: ['volatility', 'breakout'], likesCount: 31, commentsCount: 6,
  },
];

// Follower wallet addresses (synthetic QA wallets)
const FOLLOWERS = [
  '5QaFollower01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '5QaFollower02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '5QaFollower03ccccccccccccccccccccccccccccccccccccc',
  '5QaFollower04ddddddddddddddddddddddddddddddddddddd',
  '5QaFollower05eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '5QaFollower06fffffffffffffffffffffffffffffffffffff',
  '5QaFollower07ggggggggggggggggggggggggggggggggggggg',
  '5QaFollower08hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
];

async function main() {
  const leaderIdByUsername = new Map<string, string>();

  for (const l of LEADERS) {
    const leader = await prisma.leader.upsert({
      where: { username: l.username },
      update: {
        name: l.name, address: l.address, isAi: l.isAi, isVerified: l.isVerified,
        bio: l.bio, roi30d: l.roi30d, roi90d: l.roi90d, winRate: l.winRate,
        avgProfit: l.avgProfit, sharpe: l.sharpe, drawdown: l.drawdown,
        totalAum: l.totalAum, performanceFeeBps: l.performanceFeeBps,
        tags: l.tags, pnlHistory: l.pnlHistory,
      },
      create: {
        username: l.username, name: l.name, address: l.address, isAi: l.isAi,
        isVerified: l.isVerified, bio: l.bio, roi30d: l.roi30d, roi90d: l.roi90d,
        winRate: l.winRate, avgProfit: l.avgProfit, sharpe: l.sharpe,
        drawdown: l.drawdown, totalAum: l.totalAum,
        performanceFeeBps: l.performanceFeeBps, tags: l.tags,
        pnlHistory: l.pnlHistory,
      },
    });
    leaderIdByUsername.set(l.username, leader.id);

    // CopyVault (1:1) so vault equity / copy-trade target is testable.
    await prisma.copyVault.upsert({
      where: { leaderId: leader.id },
      update: { totalEquity: l.vaultEquity, totalDeposits: l.vaultEquity },
      create: {
        leaderId: leader.id, name: `${l.name} Vault`,
        collateralToken: 'USDT', totalEquity: l.vaultEquity,
        totalDeposits: l.vaultEquity, totalShares: l.vaultEquity,
      },
    });
  }

  // Ideas (idempotent: dedupe by leader+title)
  for (const idea of IDEAS) {
    const leaderId = leaderIdByUsername.get(idea.leaderUsername)!;
    const existing = await prisma.socialIdea.findFirst({
      where: { leaderId, title: idea.title },
    });
    if (existing) {
      await prisma.socialIdea.update({
        where: { id: existing.id },
        data: {
          description: idea.description, pairSymbol: idea.pairSymbol,
          direction: idea.direction, tags: idea.tags,
          likesCount: idea.likesCount, commentsCount: idea.commentsCount,
        },
      });
    } else {
      await prisma.socialIdea.create({
        data: {
          leaderId, title: idea.title, description: idea.description,
          pairSymbol: idea.pairSymbol, direction: idea.direction,
          tags: idea.tags, likesCount: idea.likesCount,
          commentsCount: idea.commentsCount,
        },
      });
    }
  }

  // Follows: spread followers across leaders (idempotent via unique constraint).
  const leaderIds = [...leaderIdByUsername.values()];
  let created = 0;
  for (let i = 0; i < leaderIds.length; i++) {
    // each leader gets a variable number of followers (2..8)
    const n = 2 + (i % 7);
    for (let j = 0; j < n; j++) {
      const followerAddress = FOLLOWERS[(i + j) % FOLLOWERS.length];
      await prisma.leaderFollow.upsert({
        where: {
          leaderId_followerAddress: { leaderId: leaderIds[i], followerAddress },
        },
        update: {},
        create: { leaderId: leaderIds[i], followerAddress },
      });
      created++;
    }
  }

  // Report
  const [leaders, ideas, follows, vaults] = await Promise.all([
    prisma.leader.count(),
    prisma.socialIdea.count(),
    prisma.leaderFollow.count(),
    prisma.copyVault.count(),
  ]);
  const humans = await prisma.leader.count({ where: { isAi: false } });
  const bots = await prisma.leader.count({ where: { isAi: true } });
  const copyTarget = leaderIdByUsername.get('lunes_quant_ai');

  console.log('SEED_DONE');
  console.log(JSON.stringify({
    leadersTotal: leaders, humans, bots, ideas, follows, vaults,
    followRowsTouched: created,
    seededLeaderIds: Object.fromEntries(leaderIdByUsername),
    copyTradeTargetLeaderId: copyTarget,
  }, null, 2));
}

main()
  .catch((e) => {
    console.error('SEED_ERROR', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
