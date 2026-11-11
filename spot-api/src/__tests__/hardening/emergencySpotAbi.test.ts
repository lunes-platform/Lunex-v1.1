/**
 * M-11 — pause/unpause/is_paused must resolve against the real SpotSettlement
 * message set, not only against hand-built mocks. spot-api/abis has no
 * Spot.json, so this reads the ABI committed for the DEX UI.
 */
jest.mock('../../config', () => ({
  config: { blockchain: {} },
}));

jest.mock('../../utils/logger', () => ({
  log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import { Abi, type ContractPromise } from '@polkadot/api-contract';
import { resolveMethodKey } from '../../services/emergencyService';

const ABI_PATH = path.resolve(
  __dirname,
  '../../../../lunes-dex-main/src/abis/SpotSettlement.json',
);

function normalize(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

describe('emergency method resolution against the SpotSettlement ABI', () => {
  const abi = new Abi(JSON.parse(fs.readFileSync(ABI_PATH, 'utf-8')));
  // ContractPromise keys tx/query by `message.method` (camelCase label).
  const methods = abi.messages.map((message) => message.method);
  const source = Object.fromEntries(methods.map((key) => [key, jest.fn()]));
  const contract = { tx: source, query: source } as unknown as ContractPromise;

  it.each([
    ['pause', 'tx', 'pause'],
    ['unpause', 'tx', 'unpause'],
    ['is_paused', 'query', 'isPaused'],
  ] as const)('%s (%s) resolves to %s', (label, kind, key) => {
    expect(resolveMethodKey(contract, label, kind)).toBe(key);
  });

  it.each(['pause', 'unpause', 'is_paused'])(
    '%s matches exactly one message',
    (label) => {
      const hits = methods.filter((key) => normalize(key) === normalize(label));
      expect(hits).toHaveLength(1);
    },
  );

  it('the real labels include the three messages', () => {
    const labels = abi.messages.map((message) => message.identifier);
    expect(labels).toEqual(
      expect.arrayContaining(['pause', 'unpause', 'is_paused']),
    );
  });
});
