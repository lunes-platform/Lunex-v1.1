import { CreateOrderInput } from '../utils/validation';
import type { Prisma } from '@prisma/client';
export declare const orderService: {
    /**
     * Create a new order, attempt matching, persist to DB
     */
    createOrder(input: CreateOrderInput): Promise<{
        price: Prisma.Decimal;
        amount: Prisma.Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Prisma.Decimal | null;
        filledAmount: Prisma.Decimal;
        remainingAmount: Prisma.Decimal;
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
        price: Prisma.Decimal;
        amount: Prisma.Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Prisma.Decimal | null;
        filledAmount: Prisma.Decimal;
        remainingAmount: Prisma.Decimal;
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
        price: Prisma.Decimal;
        amount: Prisma.Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Prisma.Decimal | null;
        filledAmount: Prisma.Decimal;
        remainingAmount: Prisma.Decimal;
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
        price: Prisma.Decimal;
        amount: Prisma.Decimal;
        id: string;
        pairId: string;
        makerAddress: string;
        side: import(".prisma/client").$Enums.OrderSide;
        type: import(".prisma/client").$Enums.OrderType;
        stopPrice: Prisma.Decimal | null;
        filledAmount: Prisma.Decimal;
        remainingAmount: Prisma.Decimal;
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