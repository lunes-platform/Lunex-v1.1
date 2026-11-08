// Item 7: an operator binds a DB vault to its deployed CopyVault contract.
// The binding is proven on-chain (READ-ONLY): the contract exists, runs the
// audited CopyVault code (code hash from the bundled ABI) and its `get_leader`
// is the vault's leader wallet. Only then can deposits be journaled.

jest.mock('../db', () => ({
  __esModule: true,
  default: {
    copyVault: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    copyVaultPosition: { count: jest.fn() },
    copyVaultDeposit: { count: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/affiliateService', () => ({
  affiliateService: { distributeCommissions: jest.fn() },
}));

import { blake2AsHex } from '@polkadot/util-crypto';
import prisma from '../db';
import {
  COPY_VAULT_SELECTORS,
  copyVaultService,
  VaultContractInspector,
  verifyVaultContractBinding,
} from '../services/copyVaultService';
import { copytradeService } from '../services/copytradeService';

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
// Same key as ALICE, encoded with SS58 prefix 57 instead of 42.
const ALICE_OTHER_PREFIX = '6mfqoTMHrMeVMyKwjqomUjVomPMJ4AjdCm1VReFtk7Be8wqr';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const VAULT = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y';
const CODE_HASH = `0x${'aa'.repeat(32)}`;

function inspector(
  overrides: Partial<{ codeHash: string | null; leader: string | null }> = {},
): VaultContractInspector {
  return {
    getCodeHash: jest.fn(async () =>
      'codeHash' in overrides ? (overrides.codeHash ?? null) : CODE_HASH,
    ),
    readLeader: jest.fn(async () =>
      'leader' in overrides ? (overrides.leader ?? null) : ALICE,
    ),
  };
}

describe('verifyVaultContractBinding', () => {
  const params = {
    contractAddress: VAULT,
    leaderAddress: ALICE,
    expectedCodeHash: CODE_HASH,
  };

  it('accepts the audited contract whose leader is the vault leader', async () => {
    await expect(
      verifyVaultContractBinding(inspector(), params),
    ).resolves.toEqual({ contractAddress: VAULT, codeHash: CODE_HASH });
  });

  it('compares leader keys independently of the SS58 prefix', async () => {
    await expect(
      verifyVaultContractBinding(
        inspector({ leader: ALICE_OTHER_PREFIX }),
        params,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects an address with no contract', async () => {
    await expect(
      verifyVaultContractBinding(inspector({ codeHash: null }), params),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VAULT_CONTRACT_NOT_FOUND',
    });
  });

  it('rejects a contract that is not the audited CopyVault code', async () => {
    await expect(
      verifyVaultContractBinding(
        inspector({ codeHash: `0x${'bb'.repeat(32)}` }),
        params,
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'VAULT_CODE_HASH_MISMATCH',
    });
  });

  it('rejects a vault contract owned by another leader', async () => {
    await expect(
      verifyVaultContractBinding(inspector({ leader: BOB }), params),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VAULT_LEADER_MISMATCH' });
  });

  it('rejects when get_leader cannot be read', async () => {
    await expect(
      verifyVaultContractBinding(inspector({ leader: null }), params),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VAULT_LEADER_MISMATCH' });
  });

  it('uses the ink! selectors derived from the message names', () => {
    const selector = (name: string) => blake2AsHex(name, 256).slice(0, 10);
    expect(COPY_VAULT_SELECTORS.deposit).toBe(selector('deposit'));
    expect(COPY_VAULT_SELECTORS.withdraw).toBe(selector('withdraw'));
    expect(COPY_VAULT_SELECTORS.getLeader).toBe(selector('get_leader'));
  });
});

describe('copytradeService.bindVaultContract', () => {
  const mockPrisma = prisma as unknown as {
    copyVault: Record<string, jest.Mock>;
    copyVaultPosition: Record<string, jest.Mock>;
    copyVaultDeposit: Record<string, jest.Mock>;
  };
  let verifySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.copyVault.findUnique.mockResolvedValue({
      id: 'vault-1',
      leaderId: 'leader-1',
      contractAddress: null,
      collateralToken: 'USDT',
      totalShares: { toString: () => '0' },
      leader: { address: ALICE },
    });
    mockPrisma.copyVault.findFirst.mockResolvedValue(null);
    mockPrisma.copyVaultPosition.count.mockResolvedValue(0);
    mockPrisma.copyVaultDeposit.count.mockResolvedValue(0);
    mockPrisma.copyVault.update.mockImplementation(async ({ data }) => ({
      id: 'vault-1',
      ...data,
    }));
    verifySpy = jest
      .spyOn(copyVaultService, 'verifyContractBinding')
      .mockResolvedValue({ contractAddress: VAULT, codeHash: CODE_HASH });
  });

  afterEach(() => verifySpy.mockRestore());

  it('binds after the on-chain check and forces LUNES collateral', async () => {
    const result = await copytradeService.bindVaultContract('leader-1', VAULT);

    expect(verifySpy).toHaveBeenCalledWith({
      contractAddress: VAULT,
      leaderAddress: ALICE,
    });
    expect(mockPrisma.copyVault.update).toHaveBeenCalledWith({
      where: { id: 'vault-1' },
      data: { contractAddress: VAULT, collateralToken: 'LUNES' },
    });
    expect(result).toEqual({
      vaultId: 'vault-1',
      leaderId: 'leader-1',
      contractAddress: VAULT,
      collateralToken: 'LUNES',
      codeHash: CODE_HASH,
    });
  });

  it('404 when the leader has no vault', async () => {
    mockPrisma.copyVault.findUnique.mockResolvedValue(null);
    await expect(
      copytradeService.bindVaultContract('leader-x', VAULT),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('409 when the vault is already bound to another contract', async () => {
    mockPrisma.copyVault.findUnique.mockResolvedValue({
      id: 'vault-1',
      leaderId: 'leader-1',
      contractAddress: BOB,
      totalShares: { toString: () => '0' },
      leader: { address: ALICE },
    });
    await expect(
      copytradeService.bindVaultContract('leader-1', VAULT),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VAULT_ALREADY_BOUND' });
    expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
  });

  it('409 when another vault already uses this contract', async () => {
    mockPrisma.copyVault.findFirst.mockResolvedValue({ id: 'vault-2' });
    await expect(
      copytradeService.bindVaultContract('leader-1', VAULT),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRACT_ALREADY_BOUND',
    });
  });

  it('409 when the vault still carries journal-only state', async () => {
    mockPrisma.copyVaultDeposit.count.mockResolvedValue(3);
    await expect(
      copytradeService.bindVaultContract('leader-1', VAULT),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'VAULT_HAS_JOURNAL_STATE',
    });
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('does not write when the chain check fails', async () => {
    verifySpy.mockRejectedValue(
      Object.assign(new Error('leader mismatch'), { statusCode: 422 }),
    );
    await expect(
      copytradeService.bindVaultContract('leader-1', VAULT),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
  });

  it('is idempotent for the same contract', async () => {
    mockPrisma.copyVault.findUnique.mockResolvedValue({
      id: 'vault-1',
      leaderId: 'leader-1',
      contractAddress: VAULT,
      collateralToken: 'LUNES',
      totalShares: { toString: () => '10' },
      leader: { address: ALICE },
    });
    const result = await copytradeService.bindVaultContract('leader-1', VAULT);
    expect(result.contractAddress).toBe(VAULT);
    expect(mockPrisma.copyVault.update).not.toHaveBeenCalled();
  });
});
