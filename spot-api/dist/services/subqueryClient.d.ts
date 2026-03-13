export interface SubquerySwapEvent {
    id: string;
    blockNumber: string;
    timestamp: string;
    extrinsicHash: string | null;
    trader: string;
    pairSymbol: string | null;
    amountIn: string;
    amountOut: string;
    tokenIn: string | null;
    tokenOut: string | null;
}
export interface SubqueryVaultEvent {
    id: string;
    blockNumber: string;
    timestamp: string;
    extrinsicHash: string | null;
    kind: 'DEPOSIT' | 'WITHDRAW' | 'TRADE_EXECUTED' | 'CIRCUIT_BREAKER';
    actor: string;
    leader: string | null;
    amountIn: string | null;
    amountOut: string | null;
    equityAfter: string | null;
    drawdownBps: string | null;
    pairSymbol: string | null;
}
export interface SubqueryTradeEvent {
    id: string;
    blockNumber: string;
    timestamp: string;
    extrinsicHash: string | null;
    kind: 'OPEN' | 'CLOSE';
    trader: string;
    pairSymbol: string | null;
    side: string | null;
    realizedPnl: string | null;
    size: string | null;
}
export interface SubqueryWalletSummary {
    id: string;
    address: string;
    totalSwapCount: number;
    totalSwapVolumeIn: string;
    totalSwapVolumeOut: string;
    totalVaultDeposited: string;
    totalVaultWithdrawn: string;
    totalTradeCount: number;
    totalRealizedPnl: string;
    winningTrades: number;
    losingTrades: number;
    lastActivityAt: string;
    firstActivityAt: string;
}
export interface SubqueryPairStats {
    id: string;
    pairSymbol: string;
    swapCount: string;
    volumeToken0: string;
    volumeToken1: string;
    lastSwapAt: string | null;
}
export interface SubqueryDailyStats {
    id: string;
    date: string;
    swapCount: string;
    swapVolumeUsd: string;
    uniqueTraders: number;
    liquidityEvents: string;
    vaultDeposits: string;
    vaultWithdrawals: string;
}
export interface SubqueryIndexerMeta {
    lastProcessedHeight: number;
    lastProcessedTimestamp: string;
    targetHeight: number;
    chain: string;
    genesisHash: string;
    indexerHealthy: boolean;
    indexerNodeVersion: string;
    queryNodeVersion: string;
}
export declare const subqueryClient: {
    isEnabled(): boolean;
    getMeta(): Promise<SubqueryIndexerMeta | null>;
    getSwapsByAddress(address: string, limit?: number): Promise<SubquerySwapEvent[]>;
    getVaultEventsByAddress(address: string, limit?: number): Promise<SubqueryVaultEvent[]>;
    getTradeEventsByAddress(address: string, limit?: number): Promise<SubqueryTradeEvent[]>;
    getAllEventsByAddress(address: string, limit?: number): Promise<{
        swaps: SubquerySwapEvent[];
        vaultEvents: SubqueryVaultEvent[];
        tradeEvents: SubqueryTradeEvent[];
    }>;
    getWalletSummary(address: string): Promise<SubqueryWalletSummary | null>;
    getPairStats(pairSymbol: string): Promise<SubqueryPairStats | null>;
    getDailyStats(days?: number): Promise<SubqueryDailyStats[]>;
    getLatestIndexedBlock(): Promise<number>;
};
//# sourceMappingURL=subqueryClient.d.ts.map