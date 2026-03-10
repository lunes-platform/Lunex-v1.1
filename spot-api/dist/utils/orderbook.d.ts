/**
 * In-memory Orderbook using sorted arrays with Price-Time Priority.
 * Bids sorted descending (highest first), Asks sorted ascending (lowest first).
 */
export interface OrderbookEntry {
    orderId: string;
    price: number;
    amount: number;
    remainingAmount: number;
    makerAddress: string;
    timestamp: number;
}
export interface OrderbookSnapshot {
    bids: Array<{
        price: number;
        amount: number;
        total: number;
    }>;
    asks: Array<{
        price: number;
        amount: number;
        total: number;
    }>;
}
export interface MatchResult {
    makerOrderId: string;
    takerOrderId: string;
    fillAmount: number;
    fillPrice: number;
    makerAddress: string;
    takerAddress: string;
}
export declare class Orderbook {
    private bids;
    private asks;
    private lastUpdatedAt;
    readonly symbol: string;
    constructor(symbol: string);
    restoreLimitOrder(orderId: string, side: 'BUY' | 'SELL', price: number, amount: number, remainingAmount: number, makerAddress: string, timestamp: number): void;
    clear(): void;
    /**
     * Add a LIMIT order to the book (after checking for matches).
     * Returns any immediate matches.
     */
    addLimitOrder(orderId: string, side: 'BUY' | 'SELL', price: number, amount: number, makerAddress: string): MatchResult[];
    /**
     * Process a MARKET order (no price limit, fill whatever is available).
     */
    addMarketOrder(orderId: string, side: 'BUY' | 'SELL', amount: number, makerAddress: string): MatchResult[];
    /**
     * Cancel an order by removing it from the book.
     */
    cancelOrder(orderId: string): boolean;
    /**
     * Get aggregated snapshot of the orderbook for API consumers.
     */
    getSnapshot(depth?: number): OrderbookSnapshot;
    getBestBid(): number | null;
    getBestAsk(): number | null;
    getSpread(): number | null;
    getLastUpdatedAt(): number | null;
    getBidCount(): number;
    getAskCount(): number;
    private insertBid;
    private insertAsk;
    private touch;
}
/**
 * Manages orderbooks for all trading pairs.
 */
export declare class OrderbookManager {
    private books;
    getOrCreate(symbol: string): Orderbook;
    get(symbol: string): Orderbook | undefined;
    getAll(): Map<string, Orderbook>;
    clearAll(): void;
}
export declare const orderbookManager: OrderbookManager;
//# sourceMappingURL=orderbook.d.ts.map