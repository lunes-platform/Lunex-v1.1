declare class SocialIndexerService {
    private api;
    private initPromise;
    private knownContracts;
    private tokenSymbolsByAddress;
    isEnabled(): boolean;
    private initialize;
    ensureReady(): Promise<boolean>;
    private getOrCreateCursor;
    getStatus(): Promise<{
        enabled: boolean;
        chain: string;
        cursor: any;
        ready: boolean;
    }>;
    private updateCursor;
    private loadKnownContracts;
    private getTokenSymbol;
    private getPairSymbolFromPath;
    private buildDecodedPayload;
    private normalizeDecodedContractEvent;
    private tryDecodeContractEvent;
    private normalizeEvent;
    private isPrunedBlockError;
    private getRecoveryStartBlock;
    private processRange;
    private processBlock;
    syncOnce(): Promise<{
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        prismaReady?: undefined;
        latestBlock?: undefined;
        lastProcessedBlock?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        prismaReady: boolean;
        latestBlock?: undefined;
        lastProcessedBlock?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        latestBlock: number;
        lastProcessedBlock: any;
        prismaReady?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        latestBlock: number;
        lastProcessedBlock: number;
        recovered: boolean;
        prismaReady?: undefined;
    }>;
}
export declare const socialIndexerService: SocialIndexerService;
export {};
//# sourceMappingURL=socialIndexerService.d.ts.map