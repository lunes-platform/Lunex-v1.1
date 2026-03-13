"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('@polkadot/util-crypto', () => ({
    cryptoWaitReady: jest.fn().mockResolvedValue(undefined),
    signatureVerify: jest.fn(),
}));
const util_crypto_1 = require("@polkadot/util-crypto");
const auth_1 = require("../../middleware/auth");
const signatureVerifyMock = util_crypto_1.signatureVerify;
describe('verifyWalletActionSignature security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it('rejects invalid signatures', async () => {
        signatureVerifyMock.mockReturnValue({ isValid: false });
        const result = await (0, auth_1.verifyWalletActionSignature)({
            action: 'copytrade.deposit',
            address: '5FakeAddress1111111111111111111111111111111111',
            nonce: 'nonce-invalid-signature',
            timestamp: Date.now(),
            signature: 'bad-signature',
            fields: {
                leaderId: 'leader-1',
                token: 'USDT',
                amount: '100',
            },
        });
        expect(result).toEqual({ ok: false, error: 'Invalid signature' });
    });
    it('rejects expired signatures before verification', async () => {
        signatureVerifyMock.mockReturnValue({ isValid: true });
        const result = await (0, auth_1.verifyWalletActionSignature)({
            action: 'social.follow-leader',
            address: '5ExpiredAddress111111111111111111111111111111111',
            nonce: 'nonce-expired-signature',
            timestamp: Date.now() - (10 * 60 * 1000),
            signature: 'signed-payload',
            fields: {
                leaderId: 'leader-1',
            },
        });
        expect(result).toEqual({ ok: false, error: 'Expired signature' });
        expect(signatureVerifyMock).not.toHaveBeenCalled();
    });
    it('rejects replayed signed actions with the same action, address, and nonce', async () => {
        signatureVerifyMock.mockReturnValue({ isValid: true });
        const input = {
            action: 'copytrade.withdraw',
            address: '5ReplayAddress1111111111111111111111111111111111',
            nonce: 'nonce-replay-same-action',
            timestamp: Date.now(),
            signature: 'signed-payload',
            fields: {
                leaderId: 'leader-1',
                shares: '50',
            },
        };
        const first = await (0, auth_1.verifyWalletActionSignature)(input);
        const second = await (0, auth_1.verifyWalletActionSignature)(input);
        expect(first.ok).toBe(true);
        expect(second).toEqual({ ok: false, error: 'Signature nonce already used' });
        expect(signatureVerifyMock).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=verifyWalletActionSignature.test.js.map