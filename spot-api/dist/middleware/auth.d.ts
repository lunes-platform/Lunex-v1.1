import { Request, Response, NextFunction } from 'express';
type SpotOrderMessageInput = {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
    price?: string;
    stopPrice?: string;
    amount: string;
    nonce: string;
};
export declare function buildSpotOrderMessage(input: SpotOrderMessageInput): string;
export declare function buildSpotCancelMessage(orderId: string): string;
export declare function buildMarginCollateralMessage(input: {
    action: 'deposit' | 'withdraw';
    token: string;
    amount: string;
}): string;
export declare function buildMarginOpenPositionMessage(input: {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    collateralAmount: string;
    leverage: string;
}): string;
export declare function buildMarginClosePositionMessage(positionId: string): string;
export declare function buildMarginLiquidatePositionMessage(positionId: string): string;
export declare function verifyAddressSignature(message: string, signature: string, address: string): Promise<boolean>;
/**
 * Middleware to validate that a request contains a valid signature.
 * In production, this verifies sr25519 signatures against the maker's public key.
 * For now, it checks that signature and makerAddress fields are present.
 */
export declare function requireSignature(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
/**
 * Middleware to validate query-based address authentication.
 * Checks that the requesting address is provided.
 */
export declare function requireAddress(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
export {};
//# sourceMappingURL=auth.d.ts.map