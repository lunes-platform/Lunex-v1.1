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

jest.mock('@polkadot/api', () => ({
  ApiPromise: {
    create: jest.fn(async () => ({
      isReady: Promise.resolve(),
      registry: { createType: jest.fn(() => ({})) },
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
