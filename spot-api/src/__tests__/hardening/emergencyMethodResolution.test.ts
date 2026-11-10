/**
 * M-11 — pause/unpause must resolve to the exact contract message. With a
 * substring match, `pause` also matched `unpause`, so depending on metadata
 * key order the "pause" button could unpause the contract. A pause whose
 * effect is not observed on-chain must come back as an error, not success.
 */
jest.mock('../../config', () => ({
  config: {
    blockchain: {
      wsUrl: 'ws://mock-node',
      spotContractAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      spotContractMetadataPath: '/mock/spot_settlement.json',
      relayerSeed: '//MockRelayer',
    },
  },
}));

jest.mock('../../utils/logger', () => ({
  log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(async () => '{}'),
}));

jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn(async () => true),
}));

const mockFindMetaError = jest.fn();

jest.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: jest.fn(async () => ({
      isReady: Promise.resolve(),
      registry: {
        createType: jest.fn(() => ({})),
        findMetaError: mockFindMetaError,
      },
    })),
  },
  WsProvider: jest.fn(),
  Keyring: jest.fn().mockImplementation(() => ({
    addFromUri: jest.fn(() => ({ address: 'relayer' })),
  })),
}));

const chain = { paused: false };
const signAndSend = jest.fn();
const tx: Record<string, jest.Mock> = {};
const mockContract = {
  tx,
  query: {
    isPaused: jest.fn(async () => ({
      result: { isOk: true },
      output: { toJSON: () => ({ ok: chain.paused }) },
    })),
  },
};

jest.mock('@polkadot/api-contract', () => ({
  ContractPromise: jest.fn().mockImplementation(() => mockContract),
}));

jest.mock('../../utils/finalizedTx', () => ({
  waitForFinalizedTx: jest.fn(),
}));

import type { ContractPromise } from '@polkadot/api-contract';
import { waitForFinalizedTx } from '../../utils/finalizedTx';
import { TxTimeoutError } from '../../utils/txWithTimeout';
import { log } from '../../utils/logger';
import {
  emergencyService,
  resolveMethodKey,
} from '../../services/emergencyService';

const waitMock = waitForFinalizedTx as jest.Mock;

function contractWith(txKeys: string[], queryKeys: string[] = []) {
  const toSource = (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, jest.fn()]));
  return {
    tx: toSource(txKeys),
    query: toSource(queryKeys),
  } as unknown as ContractPromise;
}

describe('resolveMethodKey (exact match)', () => {
  it.each([[['unpause', 'pause']], [['pause', 'unpause']]])(
    'metadata order %j: pause → pause, unpause → unpause',
    (keys) => {
      const contract = contractWith(keys);
      expect(resolveMethodKey(contract, 'pause', 'tx')).toBe('pause');
      expect(resolveMethodKey(contract, 'unpause', 'tx')).toBe('unpause');
    },
  );

  it('normalizes case/underscores but does not match substrings', () => {
    const contract = contractWith([], ['isPaused', 'pausedSince']);
    expect(resolveMethodKey(contract, 'is_paused', 'query')).toBe('isPaused');
    expect(resolveMethodKey(contract, 'paused', 'query')).toBeNull();
  });

  it('returns null when the exact message is missing', () => {
    expect(
      resolveMethodKey(contractWith(['unpause']), 'pause', 'tx'),
    ).toBeNull();
  });
});

describe('emergencyService pause flow', () => {
  // Metadata lists unpause BEFORE pause — the order that broke the old match.
  // initialize() is lazy, so the keys exist by the time it resolves them.
  tx.unpause = jest.fn(() => ({ signAndSend }));
  tx.pause = jest.fn(() => ({ signAndSend }));

  beforeEach(() => {
    chain.paused = false;
    tx.pause.mockClear();
    tx.unpause.mockClear();
    waitMock.mockReset();
  });

  it('pauseSpot sends the pause message, not unpause', async () => {
    waitMock.mockImplementation(async () => {
      chain.paused = true;
      return '0xhash';
    });
    const result = await emergencyService.pauseSpot();
    expect(tx.pause).toHaveBeenCalledTimes(1);
    expect(tx.unpause).not.toHaveBeenCalled();
    expect(result).toEqual({
      component: 'spot_settlement',
      available: true,
      paused: true,
      txHash: '0xhash',
    });
  });

  it('unpauseSpot sends the unpause message', async () => {
    chain.paused = true;
    waitMock.mockImplementation(async () => {
      chain.paused = false;
      return '0xhash2';
    });
    const result = await emergencyService.unpauseSpot();
    expect(tx.unpause).toHaveBeenCalledTimes(1);
    expect(tx.pause).not.toHaveBeenCalled();
    expect(result.paused).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('returns an explicit error when the pause tx fails on-chain', async () => {
    waitMock.mockRejectedValue(new Error('contracts.ContractReverted'));
    const result = await emergencyService.pauseSpot();
    expect(result.paused).toBeNull();
    expect(result.error).toBe('contracts.ContractReverted');
  });

  it('returns an error when the tx finalizes but the contract is still unpaused', async () => {
    // e.g. the message returned Err(Unauthorized) without a dispatch error.
    waitMock.mockResolvedValue('0xreverted');
    const result = await emergencyService.pauseSpot();
    expect(result.paused).toBe(false);
    expect(result.txHash).toBe('0xreverted');
    expect(result.error).toMatch(/not confirmed/);
  });
});

type StatusCallback = (result: Record<string, unknown>) => void;
type SendFn = (callback: StatusCallback) => Promise<unknown>;

// Simulates the pool accepting the extrinsic: one status callback, then the
// subscription stays open (finality never arrives within the window).
function broadcastOnly(hash: string) {
  signAndSend.mockImplementation(
    async (_signer: unknown, callback: StatusCallback) => {
      callback({
        status: { isBroadcast: true },
        txHash: { toHex: () => hash },
      });
      return () => undefined;
    },
  );
}

describe('emergencyService ambiguous outcome (broadcast, not finalized)', () => {
  beforeEach(() => {
    chain.paused = false;
    tx.pause.mockClear();
    tx.unpause.mockClear();
    waitMock.mockReset();
    signAndSend.mockReset();
    (log.error as jest.Mock).mockClear();
  });

  it.each([
    ['pause', false, true],
    ['unpause', true, false],
  ] as const)(
    '%s timing out after broadcast re-reads is_paused and reports pending with the tx hash',
    async (action, before, after) => {
      chain.paused = before;
      broadcastOnly('0xpending');
      waitMock.mockImplementation(async (label: string, send: SendFn) => {
        await send(() => undefined);
        // The extrinsic lands in a best block; finality stalls.
        chain.paused = after;
        throw new TxTimeoutError(label, 60_000);
      });

      const result =
        action === 'pause'
          ? await emergencyService.pauseSpot()
          : await emergencyService.unpauseSpot();

      expect(result).toEqual({
        component: 'spot_settlement',
        available: true,
        paused: after,
        pending: true,
        txHash: '0xpending',
        error: expect.stringMatching(
          new RegExp(
            `spot_settlement\\.${action} broadcast but not finalized.*re-check`,
          ),
        ),
      });
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ action, txHash: '0xpending' }),
        expect.any(String),
      );
    },
  );

  it('reports the state actually read, even when it is still the old one', async () => {
    broadcastOnly('0xslow');
    waitMock.mockImplementation(async (label: string, send: SendFn) => {
      await send(() => undefined);
      throw new TxTimeoutError(label, 60_000);
    });
    const result = await emergencyService.pauseSpot();
    expect(result.pending).toBe(true);
    expect(result.paused).toBe(false);
    expect(result.txHash).toBe('0xslow');
  });

  it('treats a timeout as pending even if no status callback arrived', async () => {
    waitMock.mockRejectedValue(
      new TxTimeoutError('spot_settlement.pause', 60_000),
    );
    const result = await emergencyService.pauseSpot();
    expect(result.pending).toBe(true);
    expect(result.paused).toBe(false);
    expect(result.txHash).toBeUndefined();
  });

  it('treats a non-timeout failure after broadcast as pending', async () => {
    broadcastOnly('0xws');
    waitMock.mockImplementation(async (_label: string, send: SendFn) => {
      await send(() => undefined);
      throw new Error('WebSocket is not connected');
    });
    const result = await emergencyService.pauseSpot();
    expect(result.pending).toBe(true);
    expect(result.txHash).toBe('0xws');
    expect(result.error).toMatch(/WebSocket is not connected/);
  });

  it('a failure before broadcast stays a plain failure (no pending)', async () => {
    waitMock.mockRejectedValue(new Error('1010: Invalid Transaction'));
    const result = await emergencyService.pauseSpot();
    expect(result.pending).toBeUndefined();
    expect(result.paused).toBeNull();
    expect(result.error).toBe('1010: Invalid Transaction');
  });
});

describe('emergencyService on-chain rejection', () => {
  beforeEach(() => {
    chain.paused = true;
    tx.pause.mockClear();
    tx.unpause.mockClear();
    waitMock.mockReset();
    signAndSend.mockReset();
    mockFindMetaError.mockReset();
  });

  it('unpause signed by a non-owner returns the decoded on-chain error, not pending', async () => {
    const { waitForFinalizedTx: realWait } = jest.requireActual(
      '../../utils/finalizedTx',
    );
    waitMock.mockImplementation(realWait);
    mockFindMetaError.mockReturnValue({
      section: 'contracts',
      name: 'ContractReverted',
    });
    signAndSend.mockImplementation(
      async (_signer: unknown, callback: StatusCallback) => {
        callback({
          status: { isInBlock: true },
          txHash: { toHex: () => '0xrev' },
          dispatchError: {
            isModule: true,
            asModule: { index: 8, error: '0x0b000000' },
            toString: () => '{"module":{"index":8,"error":"0x0b000000"}}',
          },
        });
        return () => undefined;
      },
    );

    const result = await emergencyService.unpauseSpot();

    expect(tx.unpause).toHaveBeenCalledTimes(1);
    expect(result.pending).toBeUndefined();
    expect(result.available).toBe(true);
    expect(result.txHash).toBe('0xrev');
    expect(result.error).toMatch(
      /^spot_settlement\.unpause rejected on-chain: contracts\.ContractReverted/,
    );
    expect(result.error).toMatch(/owner/);
    expect(result.paused).not.toBe(false);
  });
});

describe('first call on a fresh service instance (jest.isolateModules)', () => {
  // A module singleton would let an earlier test resolve the method keys and
  // hide a regression where the key is read before initialize().
  it.each(['pause', 'unpause'] as const)(
    'the first %s after a restart sends the message',
    async (action) => {
      chain.paused = action === 'unpause';
      tx.pause.mockClear();
      tx.unpause.mockClear();
      let fresh: typeof emergencyService | undefined;
      let freshWait: jest.Mock | undefined;
      jest.isolateModules(() => {
        fresh = require('../../services/emergencyService').emergencyService;
        freshWait = require('../../utils/finalizedTx').waitForFinalizedTx;
      });
      expect(fresh).not.toBe(emergencyService);
      freshWait!.mockImplementation(async () => {
        chain.paused = action === 'pause';
        return '0xfirst';
      });

      const result =
        action === 'pause'
          ? await fresh!.pauseSpot()
          : await fresh!.unpauseSpot();

      expect(tx[action]).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        component: 'spot_settlement',
        available: true,
        paused: action === 'pause',
        txHash: '0xfirst',
      });
    },
  );
});
