/**
 * BE-01/BE-02: vault deposits/withdrawals are signed ON CHAIN by the follower
 * wallet; the API only journals a finalized tx it can prove. The SDK must send
 * the tx proof (txHash + finalized blockHash) and sign it into the API message
 * exactly like spot-api/src/routes/copytrade.ts verifies it.
 */
import {
  buildCopytradeDepositSignMessage,
  buildCopytradeWithdrawSignMessage,
} from '../spot-utils';
import { CopytradeModule } from '../modules/copytrade';
import { HttpClient } from '../http-client';

const TX = `0x${'11'.repeat(32)}`;
const BLOCK = `0x${'22'.repeat(32)}`;
const FOLLOWER = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('copytrade vault proof signing (golden, unbound format)', () => {
  it('deposit message binds txHash, blockHash and the follower stop-loss', () => {
    expect(
      buildCopytradeDepositSignMessage({
        leaderId: 'leader-1',
        followerAddress: FOLLOWER,
        token: 'LUNES',
        amount: '15',
        txHash: TX,
        blockHash: BLOCK,
        stopLossPct: 20,
        nonce: 'n1',
        timestamp: 1,
      }),
    ).toBe(
      [
        'lunex-auth:copytrade.deposit',
        `address:${FOLLOWER}`,
        'amount:15',
        `blockHash:${BLOCK}`,
        'leaderId:leader-1',
        'stopLossPct:20',
        'token:LUNES',
        `txHash:${TX}`,
        'nonce:n1',
        'timestamp:1',
      ].join('\n'),
    );
  });

  it('withdraw message binds txHash and blockHash', () => {
    expect(
      buildCopytradeWithdrawSignMessage({
        leaderId: 'leader-1',
        followerAddress: FOLLOWER,
        shares: '5',
        txHash: TX,
        blockHash: BLOCK,
        nonce: 'n2',
        timestamp: 2,
      }),
    ).toBe(
      [
        'lunex-auth:copytrade.withdraw',
        `address:${FOLLOWER}`,
        `blockHash:${BLOCK}`,
        'leaderId:leader-1',
        'shares:5',
        `txHash:${TX}`,
        'nonce:n2',
        'timestamp:2',
      ].join('\n'),
    );
  });
});

describe('CopytradeModule vault writes', () => {
  function makeModule() {
    const post = jest.fn().mockResolvedValue({ ok: true });
    const http = { post } as unknown as HttpClient;
    return { module: new CopytradeModule(http), post };
  }
  const signed = { nonce: 'n', timestamp: 1, signature: '0xsig' };

  it('posts the on-chain proof with the deposit', async () => {
    const { module, post } = makeModule();
    await module.depositToVault('leader-1', {
      followerAddress: FOLLOWER,
      token: 'LUNES',
      amount: '15',
      txHash: TX,
      blockHash: BLOCK,
      ...signed,
    });
    expect(post).toHaveBeenCalledWith(
      '/api/v1/copytrade/vaults/leader-1/deposit',
      expect.objectContaining({ txHash: TX, blockHash: BLOCK }),
    );
  });

  it('refuses a deposit without a valid tx proof before calling the API', async () => {
    const { module, post } = makeModule();
    await expect(
      module.depositToVault('leader-1', {
        followerAddress: FOLLOWER,
        token: 'LUNES',
        amount: '15',
        txHash: '0x1234',
        blockHash: BLOCK,
        ...signed,
      }),
    ).rejects.toThrow(/txHash/);
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a withdrawal without a blockHash before calling the API', async () => {
    const { module, post } = makeModule();
    await expect(
      module.withdrawFromVault('leader-1', {
        followerAddress: FOLLOWER,
        shares: '5',
        txHash: TX,
        blockHash: undefined as unknown as string,
        ...signed,
      }),
    ).rejects.toThrow(/blockHash/);
    expect(post).not.toHaveBeenCalled();
  });
});
