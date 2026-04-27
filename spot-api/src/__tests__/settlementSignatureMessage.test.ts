import {
  buildSettlementOrderSignatureMessage,
  signatureToBytes,
} from '../services/settlementService';

describe('settlement order signature message', () => {
  it('rebuilds the same timestamped spot order message that the API verifies at order intake', () => {
    const message = buildSettlementOrderSignatureMessage(
      { symbol: 'LUNES/USDT' },
      {
        makerAddress: 'maker-1',
        side: 'BUY',
        type: 'LIMIT',
        price: '100',
        stopPrice: null,
        amount: '1',
        filledAmount: '0',
        nonce: '1700000000001',
        signature: '0xsigned',
        signatureTimestamp: new Date(1700000000123),
        expiresAt: null,
      },
    );

    expect(message).toBe(
      'lunex-order:LUNES/USDT:BUY:LIMIT:100:0:1:1700000000001:1700000000123',
    );
  });

  it('decodes 64-byte sr25519 hex signatures for settlement payloads', () => {
    const bytes = signatureToBytes(`0x${'ab'.repeat(64)}`);

    expect(bytes).toHaveLength(64);
    expect(bytes[0]).toBe(0xab);
    expect(bytes[63]).toBe(0xab);
  });

  it('rejects synthetic agent signatures for on-chain settlement payloads', () => {
    expect(() => signatureToBytes('agent:agent-1')).toThrow(
      'Synthetic agent/manual signatures cannot be used for on-chain settlement',
    );
  });

  it('rejects synthetic manual signatures for on-chain settlement payloads', () => {
    expect(() => signatureToBytes('manual:maker-1')).toThrow(
      'Synthetic agent/manual signatures cannot be used for on-chain settlement',
    );
  });
});
