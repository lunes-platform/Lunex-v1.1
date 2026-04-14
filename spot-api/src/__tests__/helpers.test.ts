import { computeOrderHash, getCandleOpenTime } from '../utils/helpers';
import {
  isValidPairSymbol,
  isValidAmount,
  sanitizeInput,
} from '../middleware/validation';

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
    const hash1 = computeOrderHash(params);
    const hash2 = computeOrderHash(params);
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
    const hash1 = computeOrderHash(base);
    const hash2 = computeOrderHash({ ...base, nonce: 'xyz789' });
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

    const hash1 = computeOrderHash(base);
    const hash2 = computeOrderHash({ ...base, stopPrice: '0.03100' });

    expect(hash1).not.toBe(hash2);
  });
});

describe('getCandleOpenTime', () => {
  it('should align to 1-minute boundaries', () => {
    const date = new Date('2025-01-15T10:33:45.123Z');
    const openTime = getCandleOpenTime(date, '1m');
    expect(openTime.getMinutes()).toBe(33);
    expect(openTime.getSeconds()).toBe(0);
    expect(openTime.getMilliseconds()).toBe(0);
  });

  it('should align to 1-hour boundaries', () => {
    const date = new Date('2025-01-15T10:33:45.123Z');
    const openTime = getCandleOpenTime(date, '1h');
    expect(openTime.getUTCHours()).toBe(10);
    expect(openTime.getMinutes()).toBe(0);
    expect(openTime.getSeconds()).toBe(0);
  });

  it('should align to 1-day boundaries', () => {
    const date = new Date('2025-01-15T10:33:45.123Z');
    const openTime = getCandleOpenTime(date, '1d');
    expect(openTime.getUTCHours()).toBe(0);
    expect(openTime.getUTCMinutes()).toBe(0);
    expect(openTime.getUTCSeconds()).toBe(0);
  });

  it('should align 5m candles correctly', () => {
    const date = new Date('2025-01-15T10:37:00.000Z');
    const openTime = getCandleOpenTime(date, '5m');
    expect(openTime.getUTCMinutes()).toBe(35);
  });

  it('should align 15m candles correctly', () => {
    const date = new Date('2025-01-15T10:22:00.000Z');
    const openTime = getCandleOpenTime(date, '15m');
    expect(openTime.getUTCMinutes()).toBe(15);
  });

  it('should align 4h candles correctly', () => {
    const date = new Date('2025-01-15T10:33:00.000Z');
    const openTime = getCandleOpenTime(date, '4h');
    expect(openTime.getUTCHours()).toBe(8);
    expect(openTime.getUTCMinutes()).toBe(0);
  });
});

describe('isValidPairSymbol', () => {
  it('should accept valid pair symbols', () => {
    expect(isValidPairSymbol('LUNES/USDT')).toBe(true);
    expect(isValidPairSymbol('BTC/ETH')).toBe(true);
    expect(isValidPairSymbol('SOL/USDT')).toBe(true);
    expect(isValidPairSymbol('DOT/BTC')).toBe(true);
  });

  it('should reject invalid pair symbols', () => {
    expect(isValidPairSymbol('')).toBe(false);
    expect(isValidPairSymbol('LUNES')).toBe(false);
    expect(isValidPairSymbol('LUNES/')).toBe(false);
    expect(isValidPairSymbol('/USDT')).toBe(false);
    expect(isValidPairSymbol('lunes/usdt')).toBe(false); // lowercase
    expect(isValidPairSymbol('A/B')).toBe(false); // too short
    expect(isValidPairSymbol('VERYLONGNAME/USDT')).toBe(false); // too long
    expect(isValidPairSymbol('LU NES/USDT')).toBe(false); // spaces
    expect(isValidPairSymbol('LUNES-USDT')).toBe(false); // wrong separator
  });
});

describe('isValidAmount', () => {
  it('should accept valid amounts', () => {
    expect(isValidAmount('100')).toBe(true);
    expect(isValidAmount('0.001')).toBe(true);
    expect(isValidAmount('999999.99')).toBe(true);
  });

  it('should reject invalid amounts', () => {
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-10')).toBe(false);
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('Infinity')).toBe(false);
  });
});

describe('sanitizeInput', () => {
  it('should remove HTML tags', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe(
      'scriptalert("xss")/script',
    );
  });

  it('should trim whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('should truncate long strings', () => {
    const longStr = 'a'.repeat(2000);
    expect(sanitizeInput(longStr).length).toBe(1000);
  });

  it('should handle normal strings unchanged', () => {
    expect(sanitizeInput('LUNES/USDT')).toBe('LUNES/USDT');
  });
});
