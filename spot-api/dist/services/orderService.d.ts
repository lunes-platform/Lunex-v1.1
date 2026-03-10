import { CreateOrderInput } from '../utils/validation';
import { Decimal } from '@prisma/client/runtime/library';
export declare const orderService: {
    /**
     * Create a new order, attempt matching, persist to DB
     */
    createOrder(input: CreateOrderInput): Promise<{
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Decimal | null;
        filledAmount: Decimal;
        remainingAmount: Decimal;
        status: import(".prisma/client").$Enums.OrderStatus;
        signature: string;
        nonce: string;
        orderHash: string;
        timeInForce: import(".prisma/client").$Enums.TimeInForce;
        expiresAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    } | null>;
    /**
     * Cancel an order
     */
    cancelOrder(orderId: string, makerAddress: string): Promise<{
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Decimal | null;
        filledAmount: Decimal;
        remainingAmount: Decimal;
        status: import(".prisma/client").$Enums.OrderStatus;
        signature: string;
        nonce: string;
        orderHash: string;
        timeInForce: import(".prisma/client").$Enums.TimeInForce;
        expiresAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get orders for a user
     */
    getUserOrders(makerAddress: string, status?: string, limit?: number, offset?: number): Promise<({
        pair: {
            symbol: string;
        };
    } & {
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Decimal | null;
        filledAmount: Decimal;
        remainingAmount: Decimal;
        status: import(".prisma/client").$Enums.OrderStatus;
        signature: string;
        nonce: string;
        orderHash: string;
        timeInForce: import(".prisma/client").$Enums.TimeInForce;
        expiresAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    /**
     * Get open orders for a pair (for API)
     */
    getOpenOrders(pairSymbol: string, limit?: number): Promise<{
        price: Decimal;
        amount: Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Decimal | null;
        filledAmount: Decimal;
        remainingAmount: Decimal;
        status: import(".prisma/client").$Enums.OrderStatus;
        signature: string;
        nonce: string;
        orderHash: string;
        timeInForce: import(".prisma/client").$Enums.TimeInForce;
        expiresAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
};
//# sourceMappingURL=orderService.d.ts.map