"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.copytradeService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const util_crypto_1 = require("@polkadot/util-crypto");
const library_1 = require("@prisma/client/runtime/library");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../utils/logger");
const copytrade_1 = require("../utils/copytrade");
const affiliateService_1 = require("./affiliateService");
function toDecimal(value) {
    return new library_1.Decimal(value.toFixed(18));
}
function decimalToNumber(value) {
    if (value == null)
        return 0;
    if (typeof value === 'number')
        return value;
    return parseFloat(value.toString());
}
function ensurePairRoute(pairSymbol, route) {
    if (route && route.length >= 2)
        return route;
    const [base, quote] = pairSymbol.split('/');
    if (!base || !quote)
        throw new Error('Invalid pair symbol');
    return [base, quote];
}
const API_KEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const apiKeyChallenges = new Map();
function pruneExpiredApiKeyChallenges() {
    const now = Date.now();
    for (const [challengeId, challenge] of apiKeyChallenges.entries()) {
        if (challenge.expiresAt <= now) {
            apiKeyChallenges.delete(challengeId);
        }
    }
}
function buildApiKeyChallengeMessage(leaderId, leaderAddress, challengeId, expiresAt) {
    return [
        'Lunex Copytrade API Key Rotation',
        `leaderId:${leaderId}`,
        `leaderAddress:${leaderAddress}`,
        `challengeId:${challengeId}`,
        `expiresAt:${new Date(expiresAt).toISOString()}`,
    ].join('\n');
}
async function assertValidApiKeyChallenge(leaderId, input) {
    pruneExpiredApiKeyChallenges();
    const challenge = apiKeyChallenges.get(input.challengeId);
    if (!challenge)
        throw new Error('API key challenge not found');
    if (challenge.leaderId !== leaderId)
        throw new Error('API key challenge does not match leader');
    if (challenge.leaderAddress !== input.leaderAddress)
        throw new Error('API key challenge does not match leader address');
    if (challenge.expiresAt <= Date.now()) {
        apiKeyChallenges.delete(input.challengeId);
        throw new Error('API key challenge expired');
    }
    await (0, util_crypto_1.cryptoWaitReady)();
    let isValid = false;
    try {
        isValid = (0, util_crypto_1.signatureVerify)(challenge.message, input.signature, input.leaderAddress).isValid;
    }
    catch {
        isValid = false;
    }
    if (!isValid)
        throw new Error('Invalid API key signature');
    apiKeyChallenges.delete(input.challengeId);
}
exports.copytradeService = {
    async createApiKeyChallenge(leaderId, input) {
        const leader = await db_1.default.leader.findUnique({ where: { id: leaderId } });
        if (!leader)
            throw new Error('Leader not found');
        if (leader.address !== input.leaderAddress)
            throw new Error('Leader address mismatch');
        pruneExpiredApiKeyChallenges();
        const challengeId = crypto_1.default.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + API_KEY_CHALLENGE_TTL_MS;
        const message = buildApiKeyChallengeMessage(leaderId, input.leaderAddress, challengeId, expiresAt);
        apiKeyChallenges.set(challengeId, {
            leaderId,
            leaderAddress: input.leaderAddress,
            message,
            expiresAt,
        });
        return {
            challengeId,
            message,
            expiresAt: new Date(expiresAt).toISOString(),
        };
    },
    async createOrRotateApiKey(leaderId, input) {
        const leader = await db_1.default.leader.findUnique({ where: { id: leaderId } });
        if (!leader)
            throw new Error('Leader not found');
        if (leader.address !== input.leaderAddress)
            throw new Error('Leader address mismatch');
        await assertValidApiKeyChallenge(leaderId, input);
        const apiKey = `lunex_${crypto_1.default.randomBytes(24).toString('hex')}`;
        const apiKeyHash = (0, copytrade_1.hashApiKey)(apiKey);
        await db_1.default.leader.update({
            where: { id: leaderId },
            data: {
                apiKeyHash,
                allowApiTrading: true,
            },
        });
        return {
            apiKey,
            allowApiTrading: true,
        };
    },
    async validateLeaderApiKey(leaderId, apiKey) {
        const leader = await db_1.default.leader.findUnique({ where: { id: leaderId } });
        if (!leader)
            throw new Error('Leader not found');
        if (!leader.allowApiTrading)
            throw new Error('API trading disabled for leader');
        if (!leader.apiKeyHash)
            throw new Error('Leader has no API key configured');
        if (leader.apiKeyHash !== (0, copytrade_1.hashApiKey)(apiKey))
            throw new Error('Invalid API key');
        return {
            leaderId: leader.id,
            username: leader.username,
            allowApiTrading: leader.allowApiTrading,
        };
    },
    async listVaults() {
        const vaults = await db_1.default.copyVault.findMany({
            include: {
                leader: true,
            },
            orderBy: { totalEquity: 'desc' },
        });
        return vaults.map((vault) => ({
            id: vault.id,
            leaderId: vault.leaderId,
            name: vault.name,
            collateralToken: vault.collateralToken,
            status: vault.status,
            totalEquity: decimalToNumber(vault.totalEquity),
            totalShares: decimalToNumber(vault.totalShares),
            totalDeposits: decimalToNumber(vault.totalDeposits),
            totalWithdrawals: decimalToNumber(vault.totalWithdrawals),
            minDeposit: decimalToNumber(vault.minDeposit),
            twapThreshold: decimalToNumber(vault.twapThreshold),
            maxSlippageBps: vault.maxSlippageBps,
            leader: {
                id: vault.leader.id,
                name: vault.leader.name,
                username: vault.leader.username,
                isAI: vault.leader.isAi,
                isVerified: vault.leader.isVerified,
                fee: vault.leader.performanceFeeBps / 100,
                followers: vault.leader.followersCount,
                aum: decimalToNumber(vault.leader.totalAum),
            },
        }));
    },
    async getVaultByLeader(leaderId) {
        const vault = await db_1.default.copyVault.findUnique({
            where: { leaderId },
            include: {
                leader: true,
                positions: {
                    orderBy: { updatedAt: 'desc' },
                    take: 20,
                },
            },
        });
        if (!vault)
            throw new Error('Vault not found');
        return {
            id: vault.id,
            leaderId: vault.leaderId,
            name: vault.name,
            collateralToken: vault.collateralToken,
            status: vault.status,
            totalEquity: decimalToNumber(vault.totalEquity),
            totalShares: decimalToNumber(vault.totalShares),
            totalDeposits: decimalToNumber(vault.totalDeposits),
            totalWithdrawals: decimalToNumber(vault.totalWithdrawals),
            minDeposit: decimalToNumber(vault.minDeposit),
            twapThreshold: decimalToNumber(vault.twapThreshold),
            maxSlippageBps: vault.maxSlippageBps,
            leader: {
                id: vault.leader.id,
                name: vault.leader.name,
                username: vault.leader.username,
                address: vault.leader.address,
                isAI: vault.leader.isAi,
                performanceFee: vault.leader.performanceFeeBps / 100,
            },
            positions: vault.positions.map((position) => ({
                id: position.id,
                followerAddress: position.followerAddress,
                shareBalance: decimalToNumber(position.shareBalance),
                estimatedValue: (0, copytrade_1.calculatePositionValue)(position.shareBalance.toString(), vault.totalShares.toString(), vault.totalEquity.toString()),
                netDeposited: decimalToNumber(position.netDeposited),
                totalWithdrawn: decimalToNumber(position.totalWithdrawn),
                highWaterMarkValue: decimalToNumber(position.highWaterMarkValue),
                feePaid: decimalToNumber(position.feePaid),
                realizedPnl: decimalToNumber(position.realizedPnl),
            })),
        };
    },
    async getUserPositions(address) {
        const positions = await db_1.default.copyVaultPosition.findMany({
            where: { followerAddress: address },
            include: {
                vault: {
                    include: {
                        leader: true,
                    },
                },
            },
            orderBy: { updatedAt: 'desc' },
        });
        return positions.map((position) => ({
            id: position.id,
            followerAddress: position.followerAddress,
            shareBalance: decimalToNumber(position.shareBalance),
            currentValue: (0, copytrade_1.calculatePositionValue)(position.shareBalance.toString(), position.vault.totalShares.toString(), position.vault.totalEquity.toString()),
            netDeposited: decimalToNumber(position.netDeposited),
            totalWithdrawn: decimalToNumber(position.totalWithdrawn),
            highWaterMarkValue: decimalToNumber(position.highWaterMarkValue),
            feePaid: decimalToNumber(position.feePaid),
            realizedPnl: decimalToNumber(position.realizedPnl),
            vault: {
                id: position.vault.id,
                name: position.vault.name,
                collateralToken: position.vault.collateralToken,
                leaderId: position.vault.leaderId,
                leaderName: position.vault.leader.name,
                leaderUsername: position.vault.leader.username,
            },
        }));
    },
    async depositToVault(leaderId, input) {
        return db_1.default.$transaction(async (tx) => {
            const vault = await tx.copyVault.findUnique({
                where: { leaderId },
                include: { leader: true },
            });
            if (!vault)
                throw new Error('Vault not found');
            if (vault.status !== 'ACTIVE')
                throw new Error('Vault is not active');
            if (input.token !== vault.collateralToken) {
                throw new Error(`Vault only accepts ${vault.collateralToken}`);
            }
            const amount = (0, copytrade_1.toNumber)(input.amount);
            const minDeposit = decimalToNumber(vault.minDeposit);
            if (amount < minDeposit)
                throw new Error(`Minimum deposit is ${minDeposit}`);
            const sharesMinted = (0, copytrade_1.calculateSharesToMint)(amount, vault.totalShares.toString(), vault.totalEquity.toString());
            const existingPosition = await tx.copyVaultPosition.findUnique({
                where: {
                    vaultId_followerAddress: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                    },
                },
            });
            const position = existingPosition
                ? await tx.copyVaultPosition.update({
                    where: {
                        vaultId_followerAddress: {
                            vaultId: vault.id,
                            followerAddress: input.followerAddress,
                        },
                    },
                    data: {
                        shareBalance: { increment: toDecimal(sharesMinted) },
                        netDeposited: { increment: toDecimal(amount) },
                        highWaterMarkValue: { increment: toDecimal(amount) },
                    },
                })
                : await tx.copyVaultPosition.create({
                    data: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                        shareBalance: toDecimal(sharesMinted),
                        netDeposited: toDecimal(amount),
                        highWaterMarkValue: toDecimal(amount),
                    },
                });
            const deposit = await tx.copyVaultDeposit.create({
                data: {
                    vaultId: vault.id,
                    followerAddress: input.followerAddress,
                    token: input.token,
                    amount: toDecimal(amount),
                    sharesMinted: toDecimal(sharesMinted),
                },
            });
            await tx.copyVault.update({
                where: { id: vault.id },
                data: {
                    totalEquity: { increment: toDecimal(amount) },
                    totalShares: { increment: toDecimal(sharesMinted) },
                    totalDeposits: { increment: toDecimal(amount) },
                },
            });
            const follow = await tx.leaderFollow.findUnique({
                where: {
                    leaderId_followerAddress: {
                        leaderId,
                        followerAddress: input.followerAddress,
                    },
                },
            });
            if (!follow) {
                await tx.leaderFollow.create({
                    data: {
                        leaderId,
                        followerAddress: input.followerAddress,
                    },
                });
                await tx.leader.update({
                    where: { id: leaderId },
                    data: { followersCount: { increment: 1 } },
                });
            }
            await tx.leader.update({
                where: { id: leaderId },
                data: { totalAum: { increment: toDecimal(amount) } },
            });
            return {
                depositId: deposit.id,
                sharesMinted,
                amount,
                positionId: position.id,
            };
        });
    },
    async withdrawFromVault(leaderId, input) {
        const result = await db_1.default.$transaction(async (tx) => {
            const vault = await tx.copyVault.findUnique({
                where: { leaderId },
                include: { leader: true },
            });
            if (!vault)
                throw new Error('Vault not found');
            const position = await tx.copyVaultPosition.findUnique({
                where: {
                    vaultId_followerAddress: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                    },
                },
            });
            if (!position)
                throw new Error('Position not found');
            const shares = (0, copytrade_1.toNumber)(input.shares);
            const grossAmount = (0, copytrade_1.calculateGrossWithdrawal)(shares, vault.totalShares.toString(), vault.totalEquity.toString());
            const feeInfo = (0, copytrade_1.calculatePerformanceFeeOnWithdrawal)({
                grossAmount,
                sharesToBurn: shares,
                shareBalanceBefore: position.shareBalance.toString(),
                highWaterMarkValue: position.highWaterMarkValue.toString(),
                performanceFeeBps: vault.leader.performanceFeeBps,
            });
            const netAmount = grossAmount - feeInfo.feeAmount;
            const updatedPosition = await tx.copyVaultPosition.update({
                where: {
                    vaultId_followerAddress: {
                        vaultId: vault.id,
                        followerAddress: input.followerAddress,
                    },
                },
                data: {
                    shareBalance: { decrement: toDecimal(shares) },
                    totalWithdrawn: { increment: toDecimal(netAmount) },
                    feePaid: { increment: toDecimal(feeInfo.feeAmount) },
                    realizedPnl: { increment: toDecimal(feeInfo.profitAmount - feeInfo.feeAmount) },
                    highWaterMarkValue: toDecimal(feeInfo.remainingHighWaterMark),
                },
            });
            const withdrawal = await tx.copyVaultWithdrawal.create({
                data: {
                    vaultId: vault.id,
                    followerAddress: input.followerAddress,
                    token: vault.collateralToken,
                    sharesBurned: toDecimal(shares),
                    grossAmount: toDecimal(grossAmount),
                    feeAmount: toDecimal(feeInfo.feeAmount),
                    netAmount: toDecimal(netAmount),
                    profitAmount: toDecimal(feeInfo.profitAmount),
                },
            });
            await tx.copyVault.update({
                where: { id: vault.id },
                data: {
                    totalShares: { decrement: toDecimal(shares) },
                    totalEquity: { decrement: toDecimal(grossAmount) },
                    totalWithdrawals: { increment: toDecimal(netAmount) },
                },
            });
            await tx.leader.update({
                where: { id: leaderId },
                data: {
                    totalAum: { decrement: toDecimal(grossAmount) },
                    totalPerformanceFeesEarned: { increment: toDecimal(feeInfo.feeAmount) },
                },
            });
            return {
                withdrawalId: withdrawal.id,
                grossAmount,
                feeAmount: feeInfo.feeAmount,
                netAmount,
                profitAmount: feeInfo.profitAmount,
                remainingShares: decimalToNumber(updatedPosition.shareBalance),
                collateralToken: vault.collateralToken,
                followerAddress: input.followerAddress,
            };
        });
        // Distribute affiliate commissions from the performance fee
        if (result.feeAmount > 0) {
            try {
                await affiliateService_1.affiliateService.distributeCommissions(result.followerAddress, result.collateralToken, result.feeAmount, 'COPYTRADE', result.withdrawalId);
            }
            catch (err) {
                logger_1.log.error({ err }, 'Affiliate commission on copytrade withdrawal failed');
            }
        }
        return result;
    },
    async createSignal(leaderId, input) {
        return db_1.default.$transaction(async (tx) => {
            const vault = await tx.copyVault.findUnique({
                where: { leaderId },
                include: { leader: true },
            });
            if (!vault)
                throw new Error('Vault not found');
            if (vault.status !== 'ACTIVE')
                throw new Error('Vault is not active');
            if (input.source === 'WEB3') {
                if (!input.leaderAddress) {
                    throw new Error('WEB3 signals require leaderAddress');
                }
                if (vault.leader.address !== input.leaderAddress) {
                    throw new Error('Leader address mismatch');
                }
            }
            const pair = await tx.pair.findUnique({ where: { symbol: input.pairSymbol } });
            if (!pair)
                throw new Error('Pair not found');
            const amountIn = (0, copytrade_1.toNumber)(input.amountIn);
            const amountOutMin = (0, copytrade_1.toNumber)(input.amountOutMin);
            const route = ensurePairRoute(input.pairSymbol, input.route);
            let executionPrice = input.executionPrice ? (0, copytrade_1.toNumber)(input.executionPrice) : 0;
            if (executionPrice <= 0) {
                const latestTrade = await tx.trade.findFirst({
                    where: { pairId: pair.id },
                    orderBy: { createdAt: 'desc' },
                });
                executionPrice = latestTrade ? decimalToNumber(latestTrade.price) : amountIn / Math.max(amountOutMin, 1);
            }
            const slices = (0, copytrade_1.planTwapSlices)(amountIn, vault.twapThreshold.toString());
            const totalAmountOut = (0, copytrade_1.deriveAmountOut)({
                pairSymbol: input.pairSymbol,
                side: input.side,
                amountIn,
                executionPrice,
            });
            const signal = await tx.copyTradeSignal.create({
                data: {
                    leaderId,
                    vaultId: vault.id,
                    pairId: pair.id,
                    pairSymbol: input.pairSymbol,
                    side: input.side,
                    source: input.source,
                    strategyTag: input.strategyTag,
                    amountIn: toDecimal(amountIn),
                    amountOutMin: toDecimal(amountOutMin),
                    executionPrice: toDecimal(executionPrice),
                    realizedPnlPct: input.realizedPnlPct ? toDecimal((0, copytrade_1.toNumber)(input.realizedPnlPct)) : undefined,
                    route,
                    maxSlippageBps: input.maxSlippageBps,
                    status: slices.length > 1 ? 'TWAP_EXECUTED' : 'EXECUTED',
                },
            });
            const executions = [];
            for (let index = 0; index < slices.length; index += 1) {
                const sliceAmountIn = slices[index];
                const sliceAmountOut = (0, copytrade_1.deriveAmountOut)({
                    pairSymbol: input.pairSymbol,
                    side: input.side,
                    amountIn: sliceAmountIn,
                    executionPrice,
                });
                const execution = await tx.copyTradeExecution.create({
                    data: {
                        vaultId: vault.id,
                        signalId: signal.id,
                        pairId: pair.id,
                        pairSymbol: input.pairSymbol,
                        side: input.side,
                        sliceIndex: index + 1,
                        totalSlices: slices.length,
                        amountIn: toDecimal(sliceAmountIn),
                        amountOut: toDecimal(sliceAmountOut),
                        executionPrice: toDecimal(executionPrice),
                        slippageBps: Math.min(input.maxSlippageBps, vault.maxSlippageBps),
                        status: 'EXECUTED',
                    },
                });
                executions.push(execution);
            }
            const realizedPnlPct = input.realizedPnlPct ? (0, copytrade_1.toNumber)(input.realizedPnlPct) : 0;
            const tradeStatus = input.realizedPnlPct ? 'CLOSED' : 'OPEN';
            const exitPrice = input.realizedPnlPct
                ? input.side === 'BUY'
                    ? executionPrice * (1 + realizedPnlPct / 100)
                    : executionPrice * (1 - realizedPnlPct / 100)
                : undefined;
            await tx.leaderTrade.create({
                data: {
                    leaderId,
                    pairId: pair.id,
                    pairSymbol: input.pairSymbol,
                    side: input.side,
                    entryPrice: toDecimal(executionPrice),
                    exitPrice: exitPrice ? toDecimal(exitPrice) : undefined,
                    pnlPct: toDecimal(realizedPnlPct),
                    status: tradeStatus,
                    closedAt: input.realizedPnlPct ? new Date() : undefined,
                },
            });
            if (input.realizedPnlPct) {
                const pnlDelta = amountIn * (realizedPnlPct / 100);
                const updatedVault = await tx.copyVault.update({
                    where: { id: vault.id },
                    data: {
                        totalEquity: { increment: toDecimal(pnlDelta) },
                    },
                });
                const nextPnlHistory = [...vault.leader.pnlHistory, realizedPnlPct].slice(-30);
                await tx.leader.update({
                    where: { id: leaderId },
                    data: {
                        totalAum: updatedVault.totalEquity,
                        pnlHistory: nextPnlHistory,
                    },
                });
            }
            return {
                signalId: signal.id,
                pairSymbol: signal.pairSymbol,
                side: signal.side,
                amountIn,
                totalAmountOut,
                executionPrice,
                slices: executions.map((execution) => ({
                    id: execution.id,
                    sliceIndex: execution.sliceIndex,
                    totalSlices: execution.totalSlices,
                    amountIn: decimalToNumber(execution.amountIn),
                    amountOut: decimalToNumber(execution.amountOut),
                    executionPrice: decimalToNumber(execution.executionPrice),
                })),
            };
        });
    },
    async getVaultExecutions(leaderId, limit = 50) {
        const vault = await db_1.default.copyVault.findUnique({ where: { leaderId } });
        if (!vault)
            throw new Error('Vault not found');
        const executions = await db_1.default.copyTradeExecution.findMany({
            where: { vaultId: vault.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                signal: true,
            },
        });
        return executions.map((execution) => ({
            id: execution.id,
            pairSymbol: execution.pairSymbol,
            side: execution.side,
            sliceIndex: execution.sliceIndex,
            totalSlices: execution.totalSlices,
            amountIn: decimalToNumber(execution.amountIn),
            amountOut: decimalToNumber(execution.amountOut),
            executionPrice: decimalToNumber(execution.executionPrice),
            slippageBps: execution.slippageBps,
            status: execution.status,
            strategyTag: execution.signal.strategyTag,
            createdAt: execution.createdAt,
        }));
    },
    async getActivity(address, limit = 50) {
        const [deposits, withdrawals, signals] = await Promise.all([
            db_1.default.copyVaultDeposit.findMany({
                where: address ? { followerAddress: address } : undefined,
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    vault: {
                        include: { leader: true },
                    },
                },
            }),
            db_1.default.copyVaultWithdrawal.findMany({
                where: address ? { followerAddress: address } : undefined,
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    vault: {
                        include: { leader: true },
                    },
                },
            }),
            db_1.default.copyTradeSignal.findMany({
                where: address
                    ? {
                        vault: {
                            positions: {
                                some: { followerAddress: address },
                            },
                        },
                    }
                    : undefined,
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    leader: true,
                    executions: true,
                },
            }),
        ]);
        const activity = [
            ...deposits.map((deposit) => ({
                type: 'DEPOSIT',
                createdAt: deposit.createdAt,
                leaderId: deposit.vault.leader.id,
                leaderName: deposit.vault.leader.name,
                followerAddress: deposit.followerAddress,
                amount: decimalToNumber(deposit.amount),
                token: deposit.token,
            })),
            ...withdrawals.map((withdrawal) => ({
                type: 'WITHDRAWAL',
                createdAt: withdrawal.createdAt,
                leaderId: withdrawal.vault.leader.id,
                leaderName: withdrawal.vault.leader.name,
                followerAddress: withdrawal.followerAddress,
                grossAmount: decimalToNumber(withdrawal.grossAmount),
                feeAmount: decimalToNumber(withdrawal.feeAmount),
                netAmount: decimalToNumber(withdrawal.netAmount),
                token: withdrawal.token,
            })),
            ...signals.map((signal) => ({
                type: 'SIGNAL',
                createdAt: signal.createdAt,
                leaderId: signal.leader.id,
                leaderName: signal.leader.name,
                pairSymbol: signal.pairSymbol,
                side: signal.side,
                amountIn: decimalToNumber(signal.amountIn),
                executionPrice: decimalToNumber(signal.executionPrice),
                slices: signal.executions.length,
            })),
        ];
        return activity
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, limit);
    },
};
//# sourceMappingURL=copytradeService.js.map