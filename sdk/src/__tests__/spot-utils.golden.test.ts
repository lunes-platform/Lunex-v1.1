/**
 * Golden tests do formato canônico de mensagens assinadas.
 *
 * Estes vetores CONGELAM o formato que o backend verifica
 * (spot-api/src/middleware/auth.ts) e que o frontend e o MCP reproduzem em
 * cópias próprias (lunes-dex-main/src/utils/signing.ts, mcp/lunex-agent-mcp).
 * Se um teste daqui quebrar, o formato mudou — isso INVALIDA assinaturas de
 * clientes existentes e exige migração coordenada nos 3 pacotes + backend.
 * Não "conserte" o vetor esperado sem essa coordenação.
 */
import {
  buildWalletActionSignMessage,
  buildSpotOrderSignMessage,
  buildSpotCancelSignMessage,
} from '../spot-utils';

const ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const NONCE = '1700000000000001';
const TIMESTAMP = 1700000000000;

describe('formato canônico de mensagens assinadas (golden vectors)', () => {
  it('buildWalletActionSignMessage: campos ordenados, arrays com vírgula, booleans literais', () => {
    const message = buildWalletActionSignMessage({
      action: 'social.follow',
      address: ADDRESS,
      nonce: NONCE,
      timestamp: TIMESTAMP,
      fields: {
        zeta: 'last-by-name',
        alpha: 42,
        list: ['a', 1, 'b'],
        flag: true,
        skipped: undefined,
        alsoSkipped: null,
      },
    });

    expect(message).toBe(
      [
        'lunex-auth:social.follow',
        `address:${ADDRESS}`,
        'alpha:42',
        'flag:true',
        'list:a,1,b',
        'zeta:last-by-name',
        `nonce:${NONCE}`,
        `timestamp:${TIMESTAMP}`,
      ].join('\n'),
    );
  });

  it('buildSpotOrderSignMessage: ordem posicional com defaults "0" para price/stopPrice', () => {
    expect(
      buildSpotOrderSignMessage({
        pairSymbol: 'WLUNES/LUSDT',
        side: 'BUY',
        type: 'LIMIT',
        price: '2000.5',
        amount: '10',
        nonce: NONCE,
        timestamp: TIMESTAMP,
      }),
    ).toBe(
      `lunex-order:WLUNES/LUSDT:BUY:LIMIT:2000.5:0:10:${NONCE}:${TIMESTAMP}`,
    );

    expect(
      buildSpotOrderSignMessage({
        pairSymbol: 'WLUNES/LUSDT',
        side: 'SELL',
        type: 'MARKET',
        amount: '3',
        nonce: NONCE,
        timestamp: TIMESTAMP,
      }),
    ).toBe(`lunex-order:WLUNES/LUSDT:SELL:MARKET:0:0:3:${NONCE}:${TIMESTAMP}`);
  });

  it('buildSpotCancelSignMessage: delega para o formato wallet-action com orderId', () => {
    expect(
      buildSpotCancelSignMessage({
        address: ADDRESS,
        orderId: 'order-123',
        nonce: NONCE,
        timestamp: TIMESTAMP,
      }),
    ).toBe(
      [
        'lunex-auth:orders.cancel',
        `address:${ADDRESS}`,
        'orderId:order-123',
        `nonce:${NONCE}`,
        `timestamp:${TIMESTAMP}`,
      ].join('\n'),
    );
  });
});
