import { Request, Response, NextFunction } from 'express';
declare function isNonceUsed(key: string): Promise<boolean>;
declare function markNonceUsed(key: string): Promise<void>;
type SpotOrderMessageInput = {
    pairSymbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
    price?: string;
    stopPrice?: string;
    amount: string;
    nonce: string;
    /** Unix ms timestamp. Required for new orders; omit only when re-verifying legacy stored orders. */
    timestamp?: number;
};
export declare function buildSpotOrderMessage(input: SpotOrderMessageInput): string;
export { isNonceUsed, markNonceUsed };
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
export declare function buildWalletActionMessage(input: {
    action: string;
    address: string;
    nonce: string;
    timestamp: number | string;
    fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>;
}): string;
export declare function verifyAddressSignature(message: string, signature: string, address: string): Promise<boolean>;
export declare function verifyWalletActionSignature(input: {
    action: string;
    address: string;
    nonce: string;
    timestamp: number | string;
    signature: string;
    fields?: Record<string, string | number | boolean | Array<string | number> | undefined | null>;
}): Promise<{
    ok: false;
    error: string;
    message?: undefined;
} | {
    ok: true;
    message: string;
    error?: undefined;
}>;
/**
 * Middleware to validate that a request contains a valid signature.
 * In production, this verifies sr25519 signatures against the maker's public key.
 * For now, it checks that signature and makerAddress fields are present.
 */
export declare function requireSignature(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Middleware to validate query-based address authentication.
 * Checks that the requesting address is provided.
 */
export declare function requireAddress(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=auth.d.ts.map