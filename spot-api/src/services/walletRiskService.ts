import prisma from '../db';
import { ApiError } from '../middleware/errors';
import {
  accountAddressVariants,
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
        where: {
          walletAddress: { in: accountAddressVariants(normalizedAddress) },
        },
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
    const variants = accountAddressVariants(normalizedAddress);

    await prisma.$transaction([
      prisma.bannedWallet.deleteMany({
        where: { address: { in: variants } },
      }),
      prisma.agent.updateMany({
        where: { walletAddress: { in: variants } },
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
  },
};
