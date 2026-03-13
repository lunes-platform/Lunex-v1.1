import { IncomingMessage } from 'http';
export declare function createWebSocketServer(port: number): import("ws").Server<typeof import("ws"), typeof IncomingMessage>;
/**
 * Broadcast a message to all clients subscribed to a channel
 */
export declare function broadcast(channel: string, type: string, data: any): void;
/**
 * Broadcast orderbook update
 */
export declare function broadcastOrderbookUpdate(symbol: string): void;
/**
 * Broadcast new trade
 */
export declare function broadcastTrade(symbol: string, trade: any): void;
/**
 * Broadcast ticker update
 */
export declare function broadcastTicker(symbol: string, ticker: any): void;
//# sourceMappingURL=server.d.ts.map