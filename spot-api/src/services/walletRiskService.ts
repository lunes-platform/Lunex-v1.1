import prisma from '../db';
import { ApiError } from '../middleware/errors';
import {
  accountAddressVariants,
  decodeAccountId,
  isSameAccount,
  toCanonicalAddress,
} from '../utils/validation';

/**
 * Admin input → canonical address (M-09). The explorer shows prefix 57 while
 * requests arrive canonical, so a ban stored as typed would never match.
 */
function canonicalAdminAddress(address: string) {
  const trimmed = address.trim();
  if (!trimmed) throw ApiError.badRequest('Wallet address is required');
  const canonical = toCanonicalAddress(trimmed);
  if (!canonical) throw ApiError.badRequest('Invalid wallet address');
  return canonical;
}

/**
 * Agent rows of this account in ANY stored encoding (42, 57, hex, prefix 0,
 * ...). The column holds the string as registered, so a string `in` filter
 * misses hex/other-prefix rows; decode each candidate instead (M-09). Bans
 * are rare admin operations, so the scan is acceptable until the data
 * migration canonicalizes the column.
 */
async function agentIdsOfAccount(canonical: string) {
  const candidates = await prisma.agent.findMany({
    select: { id: true, walletAddress: true },
  });
  return candidates
    .filter((row) => isSameAccount(row.walletAddress, canonical))
    .map((row) => row.id);
}

/** BannedWallet addresses of this account in any stored encoding. */
async function banAddressesOfAccount(canonical: string) {
  const rows = await prisma.bannedWallet.findMany({
    select: { address: true },
  });
  return rows
    .filter((row) => isSameAccount(row.address, canonical))
    .map((row) => row.address);
}

export const walletRiskService = {
  async banWallet(address: string, reason: string, bannedBy: string) {
    const normalizedAddress = canonicalAdminAddress(address);
    const normalizedReason = reason.trim();
    const normalizedBannedBy = bannedBy.trim();

    if (!normalizedReason) {
      throw ApiError.badRequest('Ban reason is required');
    }
    if (!normalizedBannedBy) {
      throw ApiError.badRequest('Admin user id is required');
    }

    const agentIds = await agentIdsOfAccount(normalizedAddress);

    const [ban] = await prisma.$transaction([
      prisma.bannedWallet.upsert({
        where: { address: normalizedAddress },
        create: {
          address: normalizedAddress,
          reason: normalizedReason,
          bannedBy: normalizedBannedBy,
        },
        update: {
          reason: normalizedReason,
          bannedBy: normalizedBannedBy,
        },
      }),
      prisma.agent.updateMany({
        where: { id: { in: agentIds } },
        data: { isBanned: true, banReason: normalizedReason },
      }),
    ]);

    return {
      address: ban.address,
      isBanned: true,
      reason: ban.reason,
    };
  },

  async unbanWallet(address: string) {
    const normalizedAddress = canonicalAdminAddress(address);
    // Rows written before canonicalization may hold any encoding of the key.
    const [legacyBans, agentIds] = await Promise.all([
      banAddressesOfAccount(normalizedAddress),
      agentIdsOfAccount(normalizedAddress),
    ]);
    const banAddresses = [
      ...new Set([...accountAddressVariants(normalizedAddress), ...legacyBans]),
    ];

    await prisma.$transaction([
      prisma.bannedWallet.deleteMany({
        where: { address: { in: banAddresses } },
      }),
      prisma.agent.updateMany({
        where: { id: { in: agentIds } },
        data: { isBanned: false, banReason: null },
      }),
    ]);

    return {
      address: normalizedAddress,
      isBanned: false,
    };
  },

  async assertWalletCanAct(walletAddress: string) {
    // Raw input plus every accepted SS58 encoding (canonical included), so
    // rows stored before canonicalization still block. Undecodable → raw only.
    const variants = accountAddressVariants(walletAddress);

    const [walletBan, agent] = await Promise.all([
      prisma.bannedWallet.findFirst({
        where: { address: { in: variants } },
        select: { reason: true },
      }),
      prisma.agent.findFirst({
        where: { walletAddress: { in: variants }, isBanned: true },
        select: {
          isBanned: true,
          banReason: true,
        },
      }),
    ]);

    if (walletBan) {
      throw ApiError.forbidden(
        `Wallet is banned${walletBan.reason ? `: ${walletBan.reason}` : ''}`,
      );
    }

    if (agent?.isBanned) {
      throw ApiError.forbidden(
        `Wallet is banned${agent.banReason ? `: ${agent.banReason}` : ''}`,
      );
    }

    // Legacy rows stored as hex or another SS58 prefix are not among the
    // variants: decode the (small) ban sets and compare as accounts.
    if (!decodeAccountId(walletAddress)) return;
    const [legacyBans, bannedAgents] = await Promise.all([
      prisma.bannedWallet.findMany({
        select: { address: true, reason: true },
      }),
      prisma.agent.findMany({
        where: { isBanned: true },
        select: { walletAddress: true, banReason: true },
      }),
    ]);
    const legacyBan = legacyBans.find((row) =>
      isSameAccount(row.address, walletAddress),
    );
    const legacyAgent = bannedAgents.find((row) =>
      isSameAccount(row.walletAddress, walletAddress),
    );
    if (legacyBan || legacyAgent) {
      const reason = legacyBan ? legacyBan.reason : legacyAgent?.banReason;
      throw ApiError.forbidden(
        `Wallet is banned${reason ? `: ${reason}` : ''}`,
      );
    }
  },
};
