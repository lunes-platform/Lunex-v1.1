declare class RebalancerService {
    private api;
    private relayer;
    private initPromise;
    private asymmetricPairAbi;
    private isConfigured;
    isEnabled(): boolean;
    ensureReady(): Promise<boolean>;
    private initialize;
    /**
     * Triggered when the on-chain indexer detects an AsymmetricSwapExecuted event.
     * Runs the full Sentinel safety pipeline before calling the Relayer.
     */
    handleCurveExecution(pairAddress: string, userAddress: string, acquiredAmount: number): Promise<void>;
    private safeRebalance;
    private executeWithRetry;
    private sendUpdateCurveTx;
    private getSystemHealth;
}
export declare const rebalancerService: RebalancerService;
export {};
//# sourceMappingURL=rebalancerService.d.ts.map