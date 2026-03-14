import { HttpClient } from '../http-client';
import {
    CancelSpotOrderInput,
    CreateSpotOrderInput,
    PrepareSignedCancelOrderInput,
    PrepareSignedSpotOrderInput,
    SpotOrder,
    SpotTrade,
} from '../spot-types';
import { buildSpotCancelSignMessage, buildSpotOrderSignMessage, generateNonce } from '../spot-utils';

function assertPositiveAmount(value: string, field: string) {
    if (!value || Number(value) <= 0) {
        throw new Error(`${field} must be a positive number string`);
    }
}

function assertOrderShape(input: PrepareSignedSpotOrderInput | CreateSpotOrderInput) {
    assertPositiveAmount(input.amount, 'amount');

    if ((input.type === 'LIMIT' || input.type === 'STOP_LIMIT') && (!input.price || Number(input.price) <= 0)) {
        throw new Error('price is required for LIMIT and STOP_LIMIT orders');
    }

    if ((input.type === 'STOP' || input.type === 'STOP_LIMIT') && (!input.stopPrice || Number(input.stopPrice) <= 0)) {
        throw new Error('stopPrice is required for STOP and STOP_LIMIT orders');
    }
}

export class OrdersModule {
    constructor(private http: HttpClient) { }

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
    }): string {
        return buildSpotOrderSignMessage(input);
    }

    buildCancelSignMessage(orderId: string): string {
        return buildSpotCancelSignMessage(orderId);
    }

    async prepareSignedOrder(input: PrepareSignedSpotOrderInput): Promise<CreateSpotOrderInput> {
        assertOrderShape(input);

        const nonce = input.nonce || generateNonce();
        const signature = await input.signMessage(
            buildSpotOrderSignMessage({
                pairSymbol: input.pairSymbol,
                side: input.side,
                type: input.type,
                price: input.price,
                stopPrice: input.stopPrice,
                amount: input.amount,
                nonce,
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
            signature,
        };
    }

    async createOrder(input: CreateSpotOrderInput): Promise<SpotOrder> {
        assertOrderShape(input);
        const response = await this.http.post<{ order: SpotOrder }>('/api/v1/orders', {
            ...input,
            timeInForce: input.timeInForce || 'GTC',
        });
        return response.order;
    }

    async createSignedOrder(input: PrepareSignedSpotOrderInput): Promise<SpotOrder> {
        const order = await this.prepareSignedOrder(input);
        return this.createOrder(order);
    }

    async prepareSignedCancelOrder(input: PrepareSignedCancelOrderInput): Promise<CancelSpotOrderInput> {
        const signature = await input.signMessage(buildSpotCancelSignMessage(input.orderId));
        return {
            makerAddress: input.makerAddress,
            signature,
        };
    }

    async cancelOrder(orderId: string, input: CancelSpotOrderInput): Promise<SpotOrder> {
        const response = await this.http.delete<{ order: SpotOrder }>(`/api/v1/orders/${orderId}`, input);
        return response.order;
    }

    async cancelSignedOrder(input: PrepareSignedCancelOrderInput): Promise<SpotOrder> {
        const payload = await this.prepareSignedCancelOrder(input);
        return this.cancelOrder(input.orderId, payload);
    }

    async getUserOrders(params: {
        makerAddress: string;
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<SpotOrder[]> {
        const response = await this.http.get<{ orders: SpotOrder[] }>('/api/v1/orders', params);
        return response.orders;
    }

    async getUserTrades(params: {
        address: string;
        limit?: number;
        offset?: number;
    }): Promise<SpotTrade[]> {
        const response = await this.http.get<{ trades: SpotTrade[] }>('/api/v1/trades', params);
        return response.trades;
    }
}
