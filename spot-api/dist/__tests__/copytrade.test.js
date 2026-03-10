"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const copytrade_1 = require("../utils/copytrade");
describe('calculateSharesToMint', () => {
    it('mints 1:1 shares for the first deposit', () => {
        expect((0, copytrade_1.calculateSharesToMint)(1000, 0, 0)).toBe(1000);
    });
    it('mints proportional shares for subsequent deposits', () => {
        expect((0, copytrade_1.calculateSharesToMint)(500, 1000, 2000)).toBe(250);
    });
    it('rejects non-positive deposits', () => {
        expect(() => (0, copytrade_1.calculateSharesToMint)(0, 1000, 1000)).toThrow('Deposit amount must be positive');
    });
});
describe('calculateGrossWithdrawal', () => {
    it('returns proportional withdrawal value', () => {
        expect((0, copytrade_1.calculateGrossWithdrawal)(250, 1000, 4000)).toBe(1000);
    });
    it('rejects invalid share burns', () => {
        expect(() => (0, copytrade_1.calculateGrossWithdrawal)(0, 1000, 4000)).toThrow('Shares to burn must be positive');
        expect(() => (0, copytrade_1.calculateGrossWithdrawal)(1200, 1000, 4000)).toThrow('Cannot burn more shares than vault supply');
    });
});
describe('calculatePerformanceFeeOnWithdrawal', () => {
    it('charges performance fee only on gains above high-water mark', () => {
        const result = (0, copytrade_1.calculatePerformanceFeeOnWithdrawal)({
            grossAmount: 1600,
            sharesToBurn: 50,
            shareBalanceBefore: 100,
            highWaterMarkValue: 1200,
            performanceFeeBps: 1500,
        });
        expect(result.highWaterMarkConsumed).toBe(600);
        expect(result.profitAmount).toBe(1000);
        expect(result.feeAmount).toBe(150);
        expect(result.remainingHighWaterMark).toBe(600);
    });
    it('charges zero fee when there is no profit', () => {
        const result = (0, copytrade_1.calculatePerformanceFeeOnWithdrawal)({
            grossAmount: 500,
            sharesToBurn: 50,
            shareBalanceBefore: 100,
            highWaterMarkValue: 1200,
            performanceFeeBps: 1500,
        });
        expect(result.profitAmount).toBe(0);
        expect(result.feeAmount).toBe(0);
    });
});
describe('calculatePositionValue', () => {
    it('returns current proportional value', () => {
        expect((0, copytrade_1.calculatePositionValue)(250, 1000, 5000)).toBe(1250);
    });
    it('returns zero for empty positions', () => {
        expect((0, copytrade_1.calculatePositionValue)(0, 1000, 5000)).toBe(0);
        expect((0, copytrade_1.calculatePositionValue)(100, 0, 5000)).toBe(0);
    });
});
describe('planTwapSlices', () => {
    it('returns a single slice below threshold', () => {
        expect((0, copytrade_1.planTwapSlices)(1000, 5000)).toEqual([1000]);
    });
    it('splits large orders into multiple slices preserving total amount', () => {
        const slices = (0, copytrade_1.planTwapSlices)(100000, 30000);
        const total = slices.reduce((sum, amount) => sum + amount, 0);
        expect(slices.length).toBe(4);
        expect(total).toBeCloseTo(100000, 8);
        expect(Math.max(...slices)).toBeLessThanOrEqual(30000);
    });
});
describe('hashApiKey', () => {
    it('creates deterministic hashes', () => {
        const hash1 = (0, copytrade_1.hashApiKey)('lunex_demo_key');
        const hash2 = (0, copytrade_1.hashApiKey)('lunex_demo_key');
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });
    it('creates different hashes for different keys', () => {
        expect((0, copytrade_1.hashApiKey)('key_a')).not.toBe((0, copytrade_1.hashApiKey)('key_b'));
    });
});
describe('deriveAmountOut', () => {
    it('derives quote output for SELL flows', () => {
        expect((0, copytrade_1.deriveAmountOut)({ pairSymbol: 'LUNES/USDT', side: 'SELL', amountIn: 1000, executionPrice: 0.03 })).toBe(30);
    });
    it('derives base output for BUY flows', () => {
        expect((0, copytrade_1.deriveAmountOut)({ pairSymbol: 'LUNES/USDT', side: 'BUY', amountIn: 30, executionPrice: 0.03 })).toBeCloseTo(1000, 8);
    });
});
describe('presentation helpers', () => {
    it('abbreviates AUM values', () => {
        expect((0, copytrade_1.abbreviateAum)(2500000)).toBe('2.5M');
        expect((0, copytrade_1.abbreviateAum)(12500)).toBe('12.5K');
        expect((0, copytrade_1.abbreviateAum)(12)).toBe('12.00');
    });
    it('formats member dates', () => {
        expect((0, copytrade_1.formatMemberSince)(new Date('2025-03-01T00:00:00Z'))).toBe('Mar 2025');
    });
});
//# sourceMappingURL=copytrade.test.js.map