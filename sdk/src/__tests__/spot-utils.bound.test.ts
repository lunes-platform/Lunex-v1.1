/**
 * Golden vectors do formato VINCULADO a domínio + chain (FE-03). Devem
 * coincidir byte a byte com spot-api/src/middleware/auth.ts
 * (buildWalletActionMessage / buildSpotOrderMessage) e com
 * lunes-dex-main/src/utils/signing.ts.
 */
import {
  buildSpotCancelSignMessage,
  buildSpotOrderSignMessage,
  buildWalletActionSignMessage,
  configureSigningContext,
} from '../spot-utils';

const GENESIS = `0x${'ab'.repeat(32)}`;
const CONTEXT = { domain: 'lunex.lunes.io', chain: GENESIS };

afterEach(() => configureSigningContext(null));

describe('formato vinculado a domínio/chain (golden vectors)', () => {
  it('wallet action com contexto explícito', () => {
    expect(
      buildWalletActionSignMessage(
        {
          action: 'favorites.add',
          address: 'addr',
          nonce: 'n1',
          timestamp: 1,
          fields: { pairSymbol: 'LUNES/USDT' },
        },
        CONTEXT,
      ),
    ).toBe(
      [
        'lunex-auth:favorites.add',
        'domain:lunex.lunes.io',
        `chain:${GENESIS}`,
        'address:addr',
        'pairSymbol:LUNES/USDT',
        'nonce:n1',
        'timestamp:1',
      ].join('\n'),
    );
  });

  it('ordem v3 com contexto configurado globalmente', () => {
    configureSigningContext({ domain: 'Lunex.Lunes.io', chain: GENESIS });
    expect(
      buildSpotOrderSignMessage({
        pairSymbol: 'LUNES/USDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '1',
        amount: '2',
        nonce: 'order-n-1',
        timestamp: 1700000000000,
        timeInForce: 'GTC',
      }),
    ).toBe(
      `lunex-order-v3:lunex.lunes.io:${GENESIS}:LUNES/USDT:BUY:LIMIT:1:0:2:order-n-1:1700000000000:GTC:0`,
    );
    expect(
      buildSpotCancelSignMessage({
        address: 'addr',
        orderId: 'o1',
        nonce: 'n',
        timestamp: 1,
      }).split('\n')[1],
    ).toBe('domain:lunex.lunes.io');
  });

  it('sem contexto mantém o formato legado (compatibilidade)', () => {
    expect(
      buildSpotOrderSignMessage({
        pairSymbol: 'A/B',
        side: 'BUY',
        type: 'MARKET',
        amount: '1',
        nonce: 'n',
        timestamp: 1,
      }).startsWith('lunex-order-v2:'),
    ).toBe(true);
  });
});
