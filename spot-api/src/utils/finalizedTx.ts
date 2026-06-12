import { withTxTimeout } from './txWithTimeout';

type Unsubscribe = () => void;

type TxStatusResult = {
  dispatchError?: { toString(): string } | null;
  status: {
    isFinalized?: boolean;
  };
  txHash: {
    toHex(): string;
  };
};

type SignAndSendFinalized = (
  callback: (result: TxStatusResult) => void,
) => Promise<Unsubscribe>;

export function waitForFinalizedTx(
  label: string,
  signAndSend: SignAndSendFinalized,
  timeoutMs?: number,
): Promise<string> {
  let unsub: Unsubscribe | undefined;
  let settled = false;

  const cleanup = () => {
    if (unsub) {
      unsub();
      unsub = undefined;
    }
  };

  const txPromise = new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    signAndSend((txResult) => {
      if (txResult.dispatchError) {
        finish(() => reject(new Error(txResult.dispatchError!.toString())));
        return;
      }

      if (txResult.status.isFinalized) {
        const txHash = txResult.txHash.toHex();
        finish(() => resolve(txHash));
      }
    })
      .then((unsubscribe) => {
        unsub = unsubscribe;
        if (settled) cleanup();
      })
      .catch((error) => {
        finish(() => reject(error));
      });
  });

  return withTxTimeout(label, txPromise, timeoutMs).finally(cleanup);
}
