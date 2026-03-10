import { withTxTimeout, TxTimeoutError } from '../utils/txWithTimeout'

describe('withTxTimeout', () => {
  it('resolves with the promise value when it completes before the timeout', async () => {
    const result = await withTxTimeout('test-tx', Promise.resolve('ok'), 1000)
    expect(result).toBe('ok')
  })

  it('rejects with TxTimeoutError when the promise takes too long', async () => {
    const neverResolves = new Promise<never>(() => {/* intentionally never resolves */})

    await expect(withTxTimeout('slow-tx', neverResolves, 50)).rejects.toThrow(TxTimeoutError)
  })

  it('TxTimeoutError message includes label and timeout', async () => {
    const neverResolves = new Promise<never>(() => {/* intentionally never resolves */})

    try {
      await withTxTimeout('my-label', neverResolves, 50)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TxTimeoutError)
      expect((err as TxTimeoutError).message).toContain('my-label')
      expect((err as TxTimeoutError).message).toContain('50ms')
      expect((err as TxTimeoutError).name).toBe('TxTimeoutError')
    }
  })

  it('propagates rejection from the underlying promise', async () => {
    const failing = Promise.reject(new Error('chain error'))

    await expect(withTxTimeout('fail-tx', failing, 1000)).rejects.toThrow('chain error')
  })

  it('clears the timer when the promise resolves before timeout', async () => {
    jest.useFakeTimers()
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')

    const p = withTxTimeout('resolve-fast', Promise.resolve(42), 5000)
    await p

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
    jest.useRealTimers()
  })

  it('clears the timer when the promise rejects before timeout', async () => {
    jest.useFakeTimers()
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout')

    const p = withTxTimeout('reject-fast', Promise.reject(new Error('boom')), 5000)
    await p.catch(() => {/* expected */})

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
    jest.useRealTimers()
  })
})
