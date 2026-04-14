import { HttpClient } from '../http-client';
import {
  CancelSpotOrderInput,
  CreateSpotOrderInput,
  PrepareSignedCancelOrderInput,
  PrepareSignedSpotOrderInput,
  SpotOrder,
  SpotTrade,
} from '../spot-types';
import {
  buildSpotCancelSignMessage,
  buildSpotOrderSignMessage,
  buildWalletActionSignMessage,
  createWalletActionMetadata,
  generateNonce,
} from '../spot-utils';

function assertPositiveAmount(value: string, field: string) {
  if (!value || Number(value) <= 0) {
    throw new Error(`${field} must be a positive number string`);
  }
}

function assertOrderShape(
  input: PrepareSignedSpotOrderInput | CreateSpotOrderInput,
) {
  assertPositiveAmount(input.amount, 'amount');

  if (
    (input.type === 'LIMIT' || input.type === 'STOP_LIMIT') &&
    (!input.price || Number(input.price) <= 0)
  ) {
    throw new Error('price is required for LIMIT and STOP_LIMIT orders');
  }

  if (
    (input.type === 'STOP' || input.type === 'STOP_LIMIT') &&
    (!input.stopPrice || Number(input.stopPrice) <= 0)
  ) {
    throw new Error('stopPrice is required for STOP and STOP_LIMIT orders');
  }
}

type SignedReadAuth = {
  nonce?: string;
  timestamp?: number;
  signature?: string;
  signMessage?: (message: string) => Promise<string>;
};

export class OrdersModule {
  constructor(private http: HttpClient) {}

  generateNonce(): string {
    return generateNonce();
  }

  buildOrderSignMessage(input: {
    pairSymbol: string;
    side: string;
    type: string;
    price?: string;
    stopPrice?: string;
    amount: string;
    nonce: string;
    timestamp: number;
  }): string {
    return buildSpotOrderSignMessage(input);
  }

  buildCancelSignMessage(orderId: string): string {
    return buildSpotCancelSignMessage(orderId);
  }

  async prepareSignedOrder(
    input: PrepareSignedSpotOrderInput,
  ): Promise<CreateSpotOrderInput> {
    assertOrderShape(input);

    const metadata = createWalletActionMetadata();
    const nonce = input.nonce || metadata.nonce;
    const timestamp = input.timestamp ?? metadata.timestamp;
    const signature = await input.signMessage(
      buildSpotOrderSignMessage({
        pairSymbol: input.pairSymbol,
        side: input.side,
        type: input.type,
        price: input.price,
        stopPrice: input.stopPrice,
        amount: input.amount,
        nonce,
        timestamp,
      }),
    );

    return {
      pairSymbol: input.pairSymbol,
      side: input.side,
      type: input.type,
      amount: input.amount,
      makerAddress: input.makerAddress,
      price: input.price,
      stopPrice: input.stopPrice,
      timeInForce: input.timeInForce || 'GTC',
      expiresAt: input.expiresAt,
      nonce,
      timestamp,
      signature,
    };
  }

  async createOrder(input: CreateSpotOrderInput): Promise<SpotOrder> {
    assertOrderShape(input);
    if (!Number.isFinite(input.timestamp) || input.timestamp <= 0) {
      throw new Error('timestamp must be a positive unix-ms number');
    }
    const response = await this.http.post<{ order: SpotOrder }>(
      '/api/v1/orders',
      {
        ...input,
        timeInForce: input.timeInForce || 'GTC',
      },
    );
    return response.order;
  }

  async createSignedOrder(
    input: PrepareSignedSpotOrderInput,
  ): Promise<SpotOrder> {
    const order = await this.prepareSignedOrder(input);
    return this.createOrder(order);
  }

  async prepareSignedCancelOrder(
    input: PrepareSignedCancelOrderInput,
  ): Promise<CancelSpotOrderInput> {
    const signature = await input.signMessage(
      buildSpotCancelSignMessage(input.orderId),
    );
    return {
      makerAddress: input.makerAddress,
      signature,
    };
  }

  async cancelOrder(
    orderId: string,
    input: CancelSpotOrderInput,
  ): Promise<SpotOrder> {
    const response = await this.http.delete<{ order: SpotOrder }>(
      `/api/v1/orders/${orderId}`,
      input,
    );
    return response.order;
  }

  async cancelSignedOrder(
    input: PrepareSignedCancelOrderInput,
  ): Promise<SpotOrder> {
    const payload = await this.prepareSignedCancelOrder(input);
    return this.cancelOrder(input.orderId, payload);
  }

  private async resolveSignedRead(input: {
    action: string;
    address: string;
    fields?: Record<
      string,
      string | number | boolean | Array<string | number> | undefined | null
    >;
    auth?: SignedReadAuth;
  }): Promise<{ nonce: string; timestamp: number; signature: string }> {
    const auth = input.auth;
    const metadata = createWalletActionMetadata();
    const nonce = auth?.nonce ?? metadata.nonce;
    const timestamp = auth?.timestamp ?? metadata.timestamp;

    if (auth?.signature) {
      if (!auth.nonce || !auth.timestamp) {
        throw new Error(
          'signed read requires nonce and timestamp when signature is provided',
        );
      }
      return { nonce, timestamp, signature: auth.signature };
    }

    if (!auth?.signMessage) {
      throw new Error(
        'signed read requires auth.signMessage or explicit nonce/timestamp/signature',
      );
    }

    const message = buildWalletActionSignMessage({
      action: input.action,
      address: input.address,
      nonce,
      timestamp,
      fields: input.fields,
    });
    const signature = await auth.signMessage(message);
    return { nonce, timestamp, signature };
  }

  async getUserOrders(params: {
    makerAddress: string;
    status?: string;
    limit?: number;
    offset?: number;
    auth?: SignedReadAuth;
  }): Promise<SpotOrder[]> {
    const signed = await this.resolveSignedRead({
      action: 'orders.list',
      address: params.makerAddress,
      fields: {
        status: params.status,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      auth: params.auth,
    });

    const response = await this.http.get<{ orders: SpotOrder[] }>(
      '/api/v1/orders',
      {
        makerAddress: params.makerAddress,
        status: params.status,
        limit: params.limit,
        offset: params.offset,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return response.orders;
  }

  async getUserTrades(params: {
    address: string;
    limit?: number;
    offset?: number;
    auth?: SignedReadAuth;
  }): Promise<SpotTrade[]> {
    const signed = await this.resolveSignedRead({
      action: 'trades.list',
      address: params.address,
      fields: {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      auth: params.auth,
    });

    const response = await this.http.get<{ trades: SpotTrade[] }>(
      '/api/v1/trades',
      {
        address: params.address,
        limit: params.limit,
        offset: params.offset,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return response.trades;
  }
}
