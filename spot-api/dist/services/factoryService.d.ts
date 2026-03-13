/**
 * FactoryService — reads the Factory ink! contract on-chain.
 *
 * The Factory is the source of truth for pair existence.
 * This service is used by the admin pair-registration endpoint
 * to verify a pair exists on-chain before registering it in the DB.
 */
declare class FactoryService {
    private api;
    private contract;
    private initPromise;
    private isConfigured;
    private initialize;
    ensureReady(): Promise<boolean>;
    /**
     * Query the Factory contract for the Pair address of (tokenA, tokenB).
     * Returns the pair's AccountId string if it exists, or null if not yet created.
     */
    getPair(tokenA: string, tokenB: string): Promise<string | null>;
    /**
     * Returns the total number of pairs registered in the Factory.
     */
    getAllPairsLength(): Promise<number>;
    /**
     * Returns all pair addresses from the Factory, in order.
     * Iterates from index 0 to allPairsLength - 1.
     */
    getAllPairs(): Promise<string[]>;
    disconnect(): Promise<void>;
}
export declare const factoryService: FactoryService;
export {};
//# sourceMappingURL=factoryService.d.ts.map