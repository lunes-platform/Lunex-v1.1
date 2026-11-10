import { randomBytes, createHash } from 'crypto';
import prisma from '../db';
import { ApiError } from '../middleware/errors';
import { walletRiskService } from './walletRiskService';
import {
  accountAddressFilter,
  accountAddressVariants,
  decodeAccountId,
  isSameAccount,
  toCanonicalAddress,
} from '../utils/validation';
import type {
  AgentType,
  AgentApiKeyPermission,
  Prisma,
  Agent,
  Leader,
} from '@prisma/client';

// ─── Staking Tiers ──────────────────────────────────────────────

interface StakingTier {
  minStake: number;
  dailyTradeLimit: number;
  maxPositionSize: number;
  maxOpenOrders: number;
}

const STAKING_TIERS: StakingTier[] = [
  { minStake: 0, dailyTradeLimit: 10, maxPositionSize: 100, maxOpenOrders: 5 },
  {
    minStake: 100,
    dailyTradeLimit: 100,
    maxPositionSize: 1_000,
    maxOpenOrders: 20,
  },
  {
    minStake: 1_000,
    dailyTradeLimit: 500,
    maxPositionSize: 10_000,
    maxOpenOrders: 50,
  },
  {
    minStake: 10_000,
    dailyTradeLimit: 2_000,
    maxPositionSize: 100_000,
    maxOpenOrders: 200,
  },
];

function resolveTier(stakedAmount: number): {
  tier: number;
  limits: StakingTier;
} {
  let tier = 0;
  for (let i = STAKING_TIERS.length - 1; i >= 0; i--) {
    if (stakedAmount >= STAKING_TIERS[i].minStake) {
      tier = i;
      break;
    }
  }
  return { tier, limits: STAKING_TIERS[tier] };
}

// ─── On-Chain Stake Verification (fail-closed) ───────────────────
//
// SECURITY: verifyStake() credits an agent's trading tier. The tier MUST be
// derived from the *on-chain* staked balance, never from the user-supplied
// `amount`/`txHash` recorded at recordStake() time. To keep this verifiable in
// isolation (and to avoid coupling the service to a live chain connection) the
// chain lookup is injected. When no verifier is wired (the default), verifyStake
// REFUSES to credit the tier — fail-closed — so an unverified stake can never
// silently upgrade an agent.

export interface StakeChainVerifier {
  /** Whether a real chain connection is available for verification. */
  isConfigured(): boolean;
  /**
   * Returns the total staked amount (in LUNES) currently held on-chain for the
   * given account, or null when no stake exists / it cannot be read.
   */
  getOnChainStakeAmount(walletAddress: string): Promise<number | null>;
}

// Default verifier is unconfigured: verifyStake() will fail-closed until a real
// on-chain verifier is injected via setStakeChainVerifier().
let stakeChainVerifier: StakeChainVerifier | null = null;

/**
 * Inject (or clear, with null) the on-chain stake verifier. Passing null
 * restores the fail-closed default. Used by bootstrap to wire the real chain
 * client, and by tests to supply a stub.
 */
export function setStakeChainVerifier(
  verifier: StakeChainVerifier | null,
): void {
  stakeChainVerifier = verifier;
}

// ─── API Key Helpers ────────────────────────────────────────────

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `lnx_${randomBytes(32).toString('hex')}`;
  const prefix = raw.slice(0, 8);
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, prefix, hash };
}

function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ─── Service ────────────────────────────────────────────────────

export const agentService = {
  async registerAgent(input: {
    walletAddress: string;
    agentType: AgentType;
    framework?: string;
    strategyDescription?: string;
    linkLeaderId?: string;
  }) {
    // M-09: new rows are stored canonical, so one key is one agent. The
    // duplicate check also covers legacy rows under the raw string sent and
    // its 42/57 forms. Undecodable input (never past the signed route) is
    // kept as given.
    const walletAddress =
      toCanonicalAddress(input.walletAddress) ?? input.walletAddress;
    const existing = await prisma.agent.findFirst({
      where: {
        walletAddress: {
          in: [
            ...new Set([
              walletAddress,
              ...accountAddressVariants(input.walletAddress),
            ]),
          ],
        },
      },
    });
    // Legacy rows in hex or another prefix are not among the variants:
    // registration is rare, so decode the stored rows and compare accounts.
    const legacyDuplicate =
      !existing &&
      decodeAccountId(input.walletAddress) !== null &&
      (await prisma.agent.findMany({ select: { walletAddress: true } })).some(
        (row) => isSameAccount(row.walletAddress, walletAddress),
      );
    if (existing || legacyDuplicate) {
      throw new Error('Agent already registered with this wallet address');
    }

    // BE-03: an agent's signals move the linked leader's vault equity/PnL,
    // so the agent wallet must OWN the leader (leader.address). The route
    // already proved the request is signed by `walletAddress`.
    if (input.linkLeaderId) {
      const leader = await prisma.leader.findUnique({
        where: { id: input.linkLeaderId },
        select: { address: true },
      });
      if (!leader) throw ApiError.notFound('Leader not found');
      if (!isSameAccount(leader.address, walletAddress)) {
        throw ApiError.forbidden(
          'Agent wallet must own the linked leader profile',
        );
      }
    }

    const agent = await prisma.agent.create({
      data: {
        walletAddress,
        agentType: input.agentType,
        framework: input.framework || null,
        strategyDescription: input.strategyDescription || null,
        leaderId: input.linkLeaderId || null,
      },
      include: { leader: true },
    });

    return formatAgent(agent);
  },

  async createApiKey(
    agentId: string,
    input: {
      label?: string;
      permissions: AgentApiKeyPermission[];
      expiresInDays?: number;
    },
    options?: {
      /**
       * BE-13: when a key is minted by another API key, it must not outlive
       * its parent — otherwise a leaked key survives its own revocation/expiry.
       */
      maxExpiresAt?: Date;
    },
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error('Agent not found');
    if (agent.isBanned) throw new Error('Agent is banned');
    // A wallet ban covers the agent whatever encoding its row holds (M-09).
    await walletRiskService.assertWalletCanAct(agent.walletAddress);

    const activeKeys = await prisma.agentApiKey.count({
      where: { agentId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (activeKeys >= 5) {
      throw new Error('Maximum 5 active API keys per agent');
    }

    const { raw, prefix, hash } = generateApiKey();
    const expiresInDays = input.expiresInDays ?? 90;
    const requestedExpiry = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(
      options?.maxExpiresAt
        ? Math.min(requestedExpiry, options.maxExpiresAt.getTime())
        : requestedExpiry,
    );

    const apiKey = await prisma.agentApiKey.create({
      data: {
        agentId,
        label: input.label ?? 'default',
        keyPrefix: prefix,
        keyHash: hash,
        permissions: input.permissions,
        expiresAt,
      },
    });

    return {
      id: apiKey.id,
      key: raw,
      prefix,
      label: apiKey.label,
      permissions: apiKey.permissions,
      expiresAt: apiKey.expiresAt.toISOString(),
    };
  },

  async revokeApiKey(
    agentId: string,
    keyId: string,
    actor?: {
      actorKeyId: string;
      actorPermissions: AgentApiKeyPermission[];
    },
  ) {
    const key = await prisma.agentApiKey.findFirst({
      where: { id: keyId, agentId, revokedAt: null },
    });
    if (!key) throw new Error('API key not found or already revoked');

    // BE-13: an API key may revoke itself, or a key whose permissions are a
    // subset of its own (a READ_ONLY key cannot kill the TRADE key). The
    // wallet owner can always revoke everything via revokeAllApiKeys().
    if (actor && actor.actorKeyId !== keyId) {
      const granted = new Set(actor.actorPermissions);
      if (!key.permissions.every((permission) => granted.has(permission))) {
        throw ApiError.forbidden(
          'Cannot revoke an API key with permissions outside the authenticated key scope',
        );
      }
    }

    await prisma.agentApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  },

  /**
   * BE-13 emergency path, authorized by the agent OWNER WALLET signature
   * (route), not by an API key: revokes every active key.
   */
  async revokeAllApiKeys(agentId: string) {
    const { count } = await prisma.agentApiKey.updateMany({
      where: { agentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: count };
  },

  /** BE-13: wallet-signed rotation — revoke all keys, then issue one new key. */
  async rotateApiKey(
    agentId: string,
    input: {
      label?: string;
      permissions: AgentApiKeyPermission[];
      expiresInDays?: number;
    },
  ) {
    const { revoked } = await agentService.revokeAllApiKeys(agentId);
    const key = await agentService.createApiKey(agentId, input);
    return { revoked, key };
  },

  async verifyApiKey(rawKey: string) {
    const hash = hashApiKey(rawKey);
    const key = await prisma.agentApiKey.findUnique({
      where: { keyHash: hash },
      include: { agent: true },
    });

    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt < new Date()) return null;
    if (!key.agent.isActive || key.agent.isBanned) return null;
    // Wallet ban by account, even if this Agent row was never flagged
    // (stored as hex / another prefix). Fails closed like isBanned.
    try {
      await walletRiskService.assertWalletCanAct(key.agent.walletAddress);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 403) return null;
      throw err;
    }

    await prisma.agentApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      agent: key.agent,
      permissions: key.permissions,
      keyId: key.id,
    };
  },

  async getAgentProfile(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { leader: true, stakes: { where: { status: 'STAKED' } } },
    });
    if (!agent) throw new Error('Agent not found');
    return formatAgent(agent);
  },

  /** BE-11: public profile (GET /agents/:id) — no owner wallet. */
  async getPublicAgentProfile(agentId: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { leader: true, stakes: { where: { status: 'STAKED' } } },
    });
    if (!agent) throw new Error('Agent not found');
    return formatPublicAgent(agent);
  },

  async getAgentByWallet(walletAddress: string) {
    // Canonical rows plus legacy rows under the string presented (M-09).
    const agent = await prisma.agent.findFirst({
      where: { walletAddress: accountAddressFilter(walletAddress) },
      include: { leader: true, stakes: { where: { status: 'STAKED' } } },
    });
    if (!agent) return null;
    return formatAgent(agent);
  },

  async listAgents(filters: {
    agentType?: AgentType;
    isActive?: boolean;
    sortBy?: 'totalTrades' | 'totalVolume' | 'stakedAmount' | 'createdAt';
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.AgentWhereInput = {};
    if (filters.agentType) where.agentType = filters.agentType;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    where.isBanned = false;

    const orderBy: Prisma.AgentOrderByWithRelationInput =
      filters.sortBy === 'totalTrades'
        ? { totalTrades: 'desc' }
        : filters.sortBy === 'totalVolume'
          ? { totalVolume: 'desc' }
          : filters.sortBy === 'stakedAmount'
            ? { stakedAmount: 'desc' }
            : { createdAt: 'desc' };

    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        orderBy,
        take: filters.limit ?? 20,
        skip: filters.offset ?? 0,
        include: { leader: true },
      }),
      prisma.agent.count({ where }),
    ]);

    return {
      // BE-11: public listing — owner wallets are not exposed.
      agents: agents.map(formatPublicAgent),
      total,
    };
  },

  async recordStake(
    agentId: string,
    input: {
      amount: number;
      token?: string;
      txHash: string; // required — must be a real on-chain tx hash
    },
  ) {
    if (!input.txHash || input.txHash.trim() === '') {
      throw new Error(
        'txHash is required to record a stake — on-chain proof must be provided',
      );
    }
    if (input.amount <= 0) {
      throw new Error('Stake amount must be positive');
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) throw new Error('Agent not found');

    // Reject duplicate txHash — prevents the same tx from being submitted twice
    const duplicate = await prisma.agentStake.findFirst({
      where: { txHash: input.txHash },
    });
    if (duplicate) {
      throw new Error(
        'Duplicate txHash — this transaction has already been recorded',
      );
    }

    // Create stake in PENDING_VERIFICATION — tier upgrade only happens after verifyStake()
    const stake = await prisma.agentStake.create({
      data: {
        agentId,
        amount: input.amount,
        token: input.token ?? 'LUNES',
        txHash: input.txHash,
        status: 'PENDING_VERIFICATION',
      },
    });

    // Do NOT credit tier yet — tier is upgraded only by verifyStake() after on-chain check
    return {
      stakeId: stake.id,
      status: 'PENDING_VERIFICATION',
      message: 'Stake submitted. Tier upgrade pending on-chain verification.',
    };
  },

  /**
   * Confirm a stake AFTER verifying it on-chain (called by admin/relayer).
   *
   * SECURITY (fail-closed): the tier is credited from the on-chain staked
   * balance, never from the user-supplied `amount`/`txHash`. If no on-chain
   * verifier is configured, verification is rejected and the stake remains in
   * PENDING_VERIFICATION — an unverified stake can never upgrade the tier.
   */
  async verifyStake(stakeId: string) {
    const stake = await prisma.agentStake.findUnique({
      where: { id: stakeId },
      include: { agent: true },
    });
    if (!stake) throw new Error('Stake not found');
    if (stake.status !== 'PENDING_VERIFICATION') {
      throw new Error(`Stake is already in status ${stake.status}`);
    }

    // Fail-closed: refuse to credit anything without a real chain connection.
    if (!stakeChainVerifier || !stakeChainVerifier.isConfigured()) {
      throw new Error(
        'On-chain verification is not available — refusing to credit tier. ' +
          'Stake remains PENDING_VERIFICATION until the chain can be queried.',
      );
    }

    // Query the chain for the account's authoritative staked balance.
    const onChainAmount = await stakeChainVerifier.getOnChainStakeAmount(
      stake.agent.walletAddress,
    );
    if (onChainAmount === null || onChainAmount === undefined) {
      throw new Error(
        'On-chain stake not found for this account — could not be verified. ' +
          'Tier not credited.',
      );
    }

    // The recorded (user-supplied) amount must be backed by the chain. If the
    // chain shows less than what was recorded, the recorded amount is forged.
    const recordedAmount = parseFloat(stake.amount.toString());
    if (onChainAmount + 1e-9 < recordedAmount) {
      throw new Error(
        `Recorded stake amount (${recordedAmount}) does not match on-chain ` +
          `staked balance (${onChainAmount}) — refusing to credit tier (possible forged amount).`,
      );
    }

    // Tier is derived from the AUTHORITATIVE on-chain balance, not user input.
    const newTotal = onChainAmount;
    const { tier, limits } = resolveTier(newTotal);

    await prisma.$transaction([
      prisma.agentStake.update({
        where: { id: stakeId },
        data: { status: 'STAKED' },
      }),
      prisma.agent.update({
        where: { id: stake.agentId },
        data: {
          stakedAmount: newTotal,
          stakingTier: tier,
          dailyTradeLimit: limits.dailyTradeLimit,
          maxPositionSize: limits.maxPositionSize,
          maxOpenOrders: limits.maxOpenOrders,
        },
      }),
    ]);

    return { stakeId, newStakedAmount: newTotal, tier, limits };
  },

  async slashAgent(agentId: string, reason: string) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { stakes: { where: { status: 'STAKED' } } },
    });
    if (!agent) throw new Error('Agent not found');

    await prisma.$transaction([
      ...agent.stakes.map((stake) =>
        prisma.agentStake.update({
          where: { id: stake.id },
          data: {
            status: 'SLASHED',
            slashedAt: new Date(),
            slashReason: reason,
          },
        }),
      ),
      prisma.agent.update({
        where: { id: agentId },
        data: {
          stakedAmount: 0,
          stakingTier: 0,
          dailyTradeLimit: STAKING_TIERS[0].dailyTradeLimit,
          maxPositionSize: STAKING_TIERS[0].maxPositionSize,
          maxOpenOrders: STAKING_TIERS[0].maxOpenOrders,
          isBanned: true,
          banReason: reason,
        },
      }),
    ]);
  },

  async getApiKeys(agentId: string) {
    const keys = await prisma.agentApiKey.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      label: k.label,
      prefix: k.keyPrefix,
      permissions: k.permissions,
      expiresAt: k.expiresAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() || null,
      lastUsedAt: k.lastUsedAt?.toISOString() || null,
      createdAt: k.createdAt.toISOString(),
      isActive: !k.revokedAt && k.expiresAt > new Date(),
    }));
  },

  STAKING_TIERS,
};

// ─── Formatters ─────────────────────────────────────────────────

type AgentWithRelations = Agent & {
  leader?: Leader | null;
  stakes?: { id: string }[];
};

function formatAgent(agent: AgentWithRelations) {
  const { tier, limits } = resolveTier(
    parseFloat(agent.stakedAmount?.toString() ?? '0'),
  );
  return {
    id: agent.id,
    walletAddress: agent.walletAddress,
    agentType: agent.agentType,
    framework: agent.framework,
    strategyDescription: agent.strategyDescription,
    isActive: agent.isActive,
    isBanned: agent.isBanned,
    stakingTier: tier,
    stakedAmount: parseFloat(agent.stakedAmount?.toString() ?? '0'),
    tradingLimits: {
      dailyTradeLimit: limits.dailyTradeLimit,
      maxPositionSize: limits.maxPositionSize,
      maxOpenOrders: limits.maxOpenOrders,
    },
    totalTrades: agent.totalTrades,
    totalVolume: parseFloat(agent.totalVolume?.toString() ?? '0'),
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
    createdAt: agent.createdAt.toISOString(),
    leader: agent.leader
      ? {
          id: agent.leader.id,
          name: agent.leader.name,
          username: agent.leader.username,
          avatar: agent.leader.avatar,
          roi30d: parseFloat(agent.leader.roi30d?.toString() ?? '0'),
          followers: agent.leader.followersCount,
        }
      : null,
  };
}

/**
 * BE-11: public agent view. The owner wallet is private (the owner reads it
 * via READ-signed GET /agents/by-wallet or API-key GET /agents/me). The only
 * exception is an agent linked to a leader owned by the same wallet: the
 * leader's address is already public by design (leader profile / copy flow).
 */
function formatPublicAgent(agent: AgentWithRelations) {
  const { walletAddress, ...rest } = formatAgent(agent);
  const isLeaderOwnWallet =
    agent.leader != null && isSameAccount(agent.leader.address, walletAddress);
  return isLeaderOwnWallet ? { ...rest, walletAddress } : rest;
}
