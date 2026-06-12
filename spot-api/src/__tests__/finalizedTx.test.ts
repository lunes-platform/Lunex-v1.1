import { waitForFinalizedTx } from '../utils/finalizedTx';
import { TxTimeoutError } from '../utils/txWithTimeout';

const txHash = {
  toHex: () => '0xabc123',
};

describe('waitForFinalizedTx', () => {
  it('ignores isInBlock and resolves only after finality', async () => {
    const unsubscribe = jest.fn();
    let callback:
      | Parameters<Parameters<typeof waitForFinalizedTx>[1]>[0]
      | undefined;

    const promise = waitForFinalizedTx('finality-test', (cb) => {
      callback = cb;
      return Promise.resolve(unsubscribe);
    });

    callback?.({
      status: { isFinalized: false },
      txHash,
    });

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();

    callback?.({
      status: { isFinalized: true },
      txHash,
    });

    await expect(promise).resolves.toBe('0xabc123');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects dispatch errors and unsubscribes', async () => {
    const unsubscribe = jest.fn();

    await expect(
      waitForFinalizedTx('dispatch-error-test', (callback) => {
        callback({
          dispatchError: { toString: () => 'Module.Error' },
          status: { isFinalized: false },
          txHash,
        });
        return Promise.resolve(unsubscribe);
      }),
    ).rejects.toThrow('Module.Error');

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('times out when finality never arrives and unsubscribes', async () => {
    const unsubscribe = jest.fn();

    await expect(
      waitForFinalizedTx('timeout-test', () => Promise.resolve(unsubscribe), 1),
    ).rejects.toBeInstanceOf(TxTimeoutError);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
