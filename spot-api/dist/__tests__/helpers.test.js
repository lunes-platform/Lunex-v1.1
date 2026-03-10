"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("../utils/helpers");
const validation_1 = require("../middleware/validation");
describe('computeOrderHash', () => {
    it('should produce consistent hashes for same input', () => {
        const params = {
            makerAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            type: 'LIMIT',
            price: '0.02345',
            stopPrice: null,
            amount: '1000',
            nonce: 'abc123',
            timeInForce: 'GTC',
            expiresAt: null,
        };
        const hash1 = (0, helpers_1.computeOrderHash)(params);
        const hash2 = (0, helpers_1.computeOrderHash)(params);
        expect(hash1).toBe(hash2);
        expect(hash1.startsWith('0x')).toBe(true);
        expect(hash1.length).toBe(66); // 0x + 64 hex chars
    });
    it('should produce different hashes for different inputs', () => {
        const base = {
            makerAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            type: 'LIMIT',
            price: '0.02345',
            stopPrice: null,
            amount: '1000',
            nonce: 'abc123',
            timeInForce: 'GTC',
            expiresAt: null,
        };
        const hash1 = (0, helpers_1.computeOrderHash)(base);
        const hash2 = (0, helpers_1.computeOrderHash)({ ...base, nonce: 'xyz789' });
        expect(hash1).not.toBe(hash2);
    });
    it('should produce different hashes when stopPrice changes', () => {
        const base = {
            makerAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            pairSymbol: 'LUNES/USDT',
            side: 'BUY',
            type: 'STOP_LIMIT',
            price: '0.02345',
            stopPrice: '0.03000',
            amount: '1000',
            nonce: 'abc123',
            timeInForce: 'GTC',
            expiresAt: null,
        };
        const hash1 = (0, helpers_1.computeOrderHash)(base);
        const hash2 = (0, helpers_1.computeOrderHash)({ ...base, stopPrice: '0.03100' });
        expect(hash1).not.toBe(hash2);
    });
});
describe('getCandleOpenTime', () => {
    it('should align to 1-minute boundaries', () => {
        const date = new Date('2025-01-15T10:33:45.123Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '1m');
        expect(openTime.getMinutes()).toBe(33);
        expect(openTime.getSeconds()).toBe(0);
        expect(openTime.getMilliseconds()).toBe(0);
    });
    it('should align to 1-hour boundaries', () => {
        const date = new Date('2025-01-15T10:33:45.123Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '1h');
        expect(openTime.getUTCHours()).toBe(10);
        expect(openTime.getMinutes()).toBe(0);
        expect(openTime.getSeconds()).toBe(0);
    });
    it('should align to 1-day boundaries', () => {
        const date = new Date('2025-01-15T10:33:45.123Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '1d');
        expect(openTime.getUTCHours()).toBe(0);
        expect(openTime.getUTCMinutes()).toBe(0);
        expect(openTime.getUTCSeconds()).toBe(0);
    });
    it('should align 5m candles correctly', () => {
        const date = new Date('2025-01-15T10:37:00.000Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '5m');
        expect(openTime.getUTCMinutes()).toBe(35);
    });
    it('should align 15m candles correctly', () => {
        const date = new Date('2025-01-15T10:22:00.000Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '15m');
        expect(openTime.getUTCMinutes()).toBe(15);
    });
    it('should align 4h candles correctly', () => {
        const date = new Date('2025-01-15T10:33:00.000Z');
        const openTime = (0, helpers_1.getCandleOpenTime)(date, '4h');
        expect(openTime.getUTCHours()).toBe(8);
        expect(openTime.getUTCMinutes()).toBe(0);
    });
});
describe('isValidPairSymbol', () => {
    it('should accept valid pair symbols', () => {
        expect((0, validation_1.isValidPairSymbol)('LUNES/USDT')).toBe(true);
        expect((0, validation_1.isValidPairSymbol)('BTC/ETH')).toBe(true);
        expect((0, validation_1.isValidPairSymbol)('SOL/USDT')).toBe(true);
        expect((0, validation_1.isValidPairSymbol)('DOT/BTC')).toBe(true);
    });
    it('should reject invalid pair symbols', () => {
        expect((0, validation_1.isValidPairSymbol)('')).toBe(false);
        expect((0, validation_1.isValidPairSymbol)('LUNES')).toBe(false);
        expect((0, validation_1.isValidPairSymbol)('LUNES/')).toBe(false);
        expect((0, validation_1.isValidPairSymbol)('/USDT')).toBe(false);
        expect((0, validation_1.isValidPairSymbol)('lunes/usdt')).toBe(false); // lowercase
        expect((0, validation_1.isValidPairSymbol)('A/B')).toBe(false); // too short
        expect((0, validation_1.isValidPairSymbol)('VERYLONGNAME/USDT')).toBe(false); // too long
        expect((0, validation_1.isValidPairSymbol)('LU NES/USDT')).toBe(false); // spaces
        expect((0, validation_1.isValidPairSymbol)('LUNES-USDT')).toBe(false); // wrong separator
    });
});
describe('isValidAmount', () => {
    it('should accept valid amounts', () => {
        expect((0, validation_1.isValidAmount)('100')).toBe(true);
        expect((0, validation_1.isValidAmount)('0.001')).toBe(true);
        expect((0, validation_1.isValidAmount)('999999.99')).toBe(true);
    });
    it('should reject invalid amounts', () => {
        expect((0, validation_1.isValidAmount)('')).toBe(false);
        expect((0, validation_1.isValidAmount)('0')).toBe(false);
        expect((0, validation_1.isValidAmount)('-10')).toBe(false);
        expect((0, validation_1.isValidAmount)('abc')).toBe(false);
        expect((0, validation_1.isValidAmount)('Infinity')).toBe(false);
    });
});
describe('sanitizeInput', () => {
    it('should remove HTML tags', () => {
        expect((0, validation_1.sanitizeInput)('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
    });
    it('should trim whitespace', () => {
        expect((0, validation_1.sanitizeInput)('  hello  ')).toBe('hello');
    });
    it('should truncate long strings', () => {
        const longStr = 'a'.repeat(2000);
        expect((0, validation_1.sanitizeInput)(longStr).length).toBe(1000);
    });
    it('should handle normal strings unchanged', () => {
        expect((0, validation_1.sanitizeInput)('LUNES/USDT')).toBe('LUNES/USDT');
    });
});
//# sourceMappingURL=helpers.test.js.map