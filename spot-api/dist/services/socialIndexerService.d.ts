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
    private syncFromSubquery;
    syncOnce(): Promise<{
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        prismaReady?: undefined;
        source?: undefined;
        latestBlock?: undefined;
        lastProcessedBlock?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        prismaReady: boolean;
        source?: undefined;
        latestBlock?: undefined;
        lastProcessedBlock?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        source: string;
        processedBlocks: number;
        indexedEvents: number;
        latestBlock: number;
        prismaReady: boolean;
        lastProcessedBlock?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        source: string;
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
        source?: undefined;
        recovered?: undefined;
    } | {
        enabled: boolean;
        processedBlocks: number;
        indexedEvents: number;
        latestBlock: number;
        lastProcessedBlock: number;
        recovered: boolean;
        prismaReady?: undefined;
        source?: undefined;
    }>;
}
export declare const socialIndexerService: SocialIndexerService;
export {};
//# sourceMappingURL=socialIndexerService.d.ts.map