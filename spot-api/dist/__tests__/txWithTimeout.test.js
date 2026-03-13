"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const txWithTimeout_1 = require("../utils/txWithTimeout");
describe('withTxTimeout', () => {
    it('resolves with the promise value when it completes before the timeout', async () => {
        const result = await (0, txWithTimeout_1.withTxTimeout)('test-tx', Promise.resolve('ok'), 1000);
        expect(result).toBe('ok');
    });
    it('rejects with TxTimeoutError when the promise takes too long', async () => {
        const neverResolves = new Promise(() => { });
        await expect((0, txWithTimeout_1.withTxTimeout)('slow-tx', neverResolves, 50)).rejects.toThrow(txWithTimeout_1.TxTimeoutError);
    });
    it('TxTimeoutError message includes label and timeout', async () => {
        const neverResolves = new Promise(() => { });
        try {
            await (0, txWithTimeout_1.withTxTimeout)('my-label', neverResolves, 50);
            fail('should have thrown');
        }
        catch (err) {
            expect(err).toBeInstanceOf(txWithTimeout_1.TxTimeoutError);
            expect(err.message).toContain('my-label');
            expect(err.message).toContain('50ms');
            expect(err.name).toBe('TxTimeoutError');
        }
    });
    it('propagates rejection from the underlying promise', async () => {
        const failing = Promise.reject(new Error('chain error'));
        await expect((0, txWithTimeout_1.withTxTimeout)('fail-tx', failing, 1000)).rejects.toThrow('chain error');
    });
    it('clears the timer when the promise resolves before timeout', async () => {
        jest.useFakeTimers();
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        const p = (0, txWithTimeout_1.withTxTimeout)('resolve-fast', Promise.resolve(42), 5000);
        await p;
        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
        jest.useRealTimers();
    });
    it('clears the timer when the promise rejects before timeout', async () => {
        jest.useFakeTimers();
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        const p = (0, txWithTimeout_1.withTxTimeout)('reject-fast', Promise.reject(new Error('boom')), 5000);
        await p.catch(() => { });
        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
        jest.useRealTimers();
    });
});
//# sourceMappingURL=txWithTimeout.test.js.map