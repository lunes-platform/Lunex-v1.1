import prisma from '../db';
import { ApiError } from '../middleware/errors';

export const walletRiskService = {
  async banWallet(address: string, reason: string, bannedBy: string) {
    const normalizedAddress = address.trim();
    const normalizedReason = reason.trim();
    const normalizedBannedBy = bannedBy.trim();

    if (!normalizedAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }
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
        where: { walletAddress: normalizedAddress },
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
    const normalizedAddress = address.trim();
    if (!normalizedAddress) {
      throw ApiError.badRequest('Wallet address is required');
    }

    await prisma.$transaction([
      prisma.bannedWallet.deleteMany({
        where: { address: normalizedAddress },
      }),
      prisma.agent.updateMany({
        where: { walletAddress: normalizedAddress },
        data: { isBanned: false, banReason: null },
      }),
    ]);

    return {
      address: normalizedAddress,
      isBanned: false,
    };
  },

  async assertWalletCanAct(walletAddress: string) {
    const [walletBan, agent] = await Promise.all([
      prisma.bannedWallet.findUnique({
        where: { address: walletAddress },
        select: { reason: true },
      }),
      prisma.agent.findUnique({
        where: { walletAddress },
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
