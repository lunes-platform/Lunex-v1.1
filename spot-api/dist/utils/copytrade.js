"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toNumber = toNumber;
exports.calculateSharesToMint = calculateSharesToMint;
exports.calculateGrossWithdrawal = calculateGrossWithdrawal;
exports.calculatePerformanceFeeOnWithdrawal = calculatePerformanceFeeOnWithdrawal;
exports.calculatePositionValue = calculatePositionValue;
exports.planTwapSlices = planTwapSlices;
exports.hashApiKey = hashApiKey;
exports.abbreviateAum = abbreviateAum;
exports.formatMemberSince = formatMemberSince;
exports.deriveAmountOut = deriveAmountOut;
const crypto_1 = __importDefault(require("crypto"));
function toNumber(value) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
        throw new Error('Invalid numeric value');
    }
    return num;
}
function calculateSharesToMint(depositAmount, totalShares, totalEquity) {
    const amount = toNumber(depositAmount);
    const shares = toNumber(totalShares);
    const equity = toNumber(totalEquity);
    if (amount <= 0)
        throw new Error('Deposit amount must be positive');
    if (shares <= 0 || equity <= 0)
        return amount;
    return amount * (shares / equity);
}
function calculateGrossWithdrawal(sharesToBurn, totalShares, totalEquity) {
    const shares = toNumber(sharesToBurn);
    const supply = toNumber(totalShares);
    const equity = toNumber(totalEquity);
    if (shares <= 0)
        throw new Error('Shares to burn must be positive');
    if (supply <= 0 || equity < 0)
        throw new Error('Vault has no liquidity');
    if (shares > supply)
        throw new Error('Cannot burn more shares than vault supply');
    return shares * (equity / supply);
}
function calculatePerformanceFeeOnWithdrawal(params) {
    const grossAmount = toNumber(params.grossAmount);
    const sharesToBurn = toNumber(params.sharesToBurn);
    const shareBalanceBefore = toNumber(params.shareBalanceBefore);
    const highWaterMarkValue = toNumber(params.highWaterMarkValue);
    if (shareBalanceBefore <= 0)
        throw new Error('Position has no shares');
    if (sharesToBurn <= 0 || sharesToBurn > shareBalanceBefore) {
        throw new Error('Invalid shares to burn');
    }
    const proportion = sharesToBurn / shareBalanceBefore;
    const highWaterMarkConsumed = highWaterMarkValue * proportion;
    const profitAmount = Math.max(grossAmount - highWaterMarkConsumed, 0);
    const feeAmount = profitAmount * (params.performanceFeeBps / 10000);
    const remainingHighWaterMark = Math.max(highWaterMarkValue - highWaterMarkConsumed, 0);
    return {
        profitAmount,
        feeAmount,
        highWaterMarkConsumed,
        remainingHighWaterMark,
    };
}
function calculatePositionValue(shareBalance, totalShares, totalEquity) {
    const balance = toNumber(shareBalance);
    const supply = toNumber(totalShares);
    const equity = toNumber(totalEquity);
    if (balance <= 0 || supply <= 0 || equity <= 0)
        return 0;
    return balance * (equity / supply);
}
function planTwapSlices(totalAmount, threshold) {
    const amount = toNumber(totalAmount);
    const limit = toNumber(threshold);
    if (amount <= 0)
        throw new Error('Amount must be positive');
    if (limit <= 0)
        throw new Error('TWAP threshold must be positive');
    if (amount <= limit)
        return [amount];
    const sliceCount = Math.ceil(amount / limit);
    const baseSlice = amount / sliceCount;
    return Array.from({ length: sliceCount }, (_unused, index) => {
        const isLast = index === sliceCount - 1;
        if (!isLast)
            return Number(baseSlice.toFixed(18));
        const executedSoFar = baseSlice * (sliceCount - 1);
        return Number((amount - executedSoFar).toFixed(18));
    });
}
function hashApiKey(apiKey) {
    return crypto_1.default.createHash('sha256').update(apiKey).digest('hex');
}
function abbreviateAum(value) {
    const num = toNumber(value);
    if (num >= 1000000)
        return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000)
        return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(2);
}
function formatMemberSince(date) {
    return date.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function deriveAmountOut(params) {
    const { side, amountIn, executionPrice } = params;
    if (executionPrice <= 0)
        return 0;
    return side === 'BUY' ? amountIn / executionPrice : amountIn * executionPrice;
}
//# sourceMappingURL=copytrade.js.map