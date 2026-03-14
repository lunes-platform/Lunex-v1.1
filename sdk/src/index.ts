import { HttpClient } from './http-client';
import { WebSocketClient, WebSocketEvent } from './websocket-client';
import { AuthModule } from './modules/auth';
import { FactoryModule } from './modules/factory';
import { RouterModule } from './modules/router';
import { PairModule } from './modules/pair';
import { StakingModule } from './modules/staking';
import { RewardsModule } from './modules/rewards';
import { WNativeModule } from './modules/wnative';
import { TokensModule } from './modules/tokens';
import { MarketModule } from './modules/market';
import { OrdersModule } from './modules/orders';
import { SocialModule } from './modules/social';
import { CopytradeModule } from './modules/copytrade';
import { AgentsModule } from './modules/agents';
import { AsymmetricModule } from './modules/asymmetric/AsymmetricClient';
import { StrategyModule } from './modules/strategy';
import { ExecutionModule } from './modules/execution';
import { LunexConfig } from './types';
import * as utils from './utils';
import * as spotUtils from './spot-utils';

/**
 * Main Lunex SDK class
 * 
 * @example
 * ```typescript
 * const sdk = new LunexSDK({
 *   baseURL: 'https://api.lunex.io/v1',
 *   wsURL: 'wss://api.lunex.io'
 * });
 * 
 * // Authenticate
 * const { nonce } = await sdk.auth.getNonce(address);
 * // ... sign nonce with wallet
 * await sdk.auth.login(address, signature, nonce);
 * 
 * // Get token with decimals
 * const token = await sdk.tokens.getToken(tokenAddress);
 * 
 * // Format user input safely
 * const parsed = sdk.tokens.parseUserInput('100.5', token.decimals);
 * 
 * // Get swap quote
 * const quote = await sdk.router.getQuote(parsed.parsed!, [tokenA, tokenB]);
 * 
 * // Execute swap
 * const result = await sdk.router.swapExactTokensForTokens({
 *   amountIn: parsed.parsed!,
 *   amountOutMin: quote.minimumReceived,
 *   path: [tokenA, tokenB],
 *   to: userAddress,
 *   deadline: sdk.utils.calculateDeadline(20)
 * });
 * ```
 */
export class LunexSDK {
    private httpClient: HttpClient;
    private wsClient: WebSocketClient;

    // Module instances
    public readonly auth: AuthModule;
    public readonly factory: FactoryModule;
    public readonly router: RouterModule;
    public readonly pair: PairModule;
    public readonly staking: StakingModule;
    public readonly rewards: RewardsModule;
    public readonly wnative: WNativeModule;
    public readonly tokens: TokensModule;
    public readonly market: MarketModule;
    public readonly orders: OrdersModule;
    public readonly social: SocialModule;
    public readonly copytrade: CopytradeModule;
    public readonly agents: AgentsModule;
    public readonly asymmetric: AsymmetricModule;
    public readonly strategies: StrategyModule;
    public readonly execution: ExecutionModule;

    // Utility functions
    public readonly utils = utils;
    public readonly spot = spotUtils;

    constructor(config: LunexConfig) {
        // Initialize HTTP client
        this.httpClient = new HttpClient(config);

        // Initialize WebSocket client
        this.wsClient = new WebSocketClient(config.wsURL || config.baseURL.replace('http', 'ws'));

        // Initialize modules
        this.auth = new AuthModule(this.httpClient);
        this.factory = new FactoryModule(this.httpClient);
        this.router = new RouterModule(this.httpClient);
        this.pair = new PairModule(this.httpClient);
        this.staking = new StakingModule(this.httpClient);
        this.rewards = new RewardsModule(this.httpClient);
        this.wnative = new WNativeModule(this.httpClient);
        this.tokens = new TokensModule(this.httpClient);
        this.market = new MarketModule(this.httpClient);
        this.orders = new OrdersModule(this.httpClient);
        this.social = new SocialModule(this.httpClient);
        this.copytrade = new CopytradeModule(this.httpClient);
        this.agents = new AgentsModule(this.httpClient);
        this.asymmetric = new AsymmetricModule(this.httpClient);
        this.strategies = new StrategyModule(this.httpClient);
        this.execution = new ExecutionModule(this.httpClient);
    }

    /**
     * Set authentication token
     * @param token - JWT token
     */
    setAuthToken(token: string): void {
        this.httpClient.setAuthToken(token);
    }

    /**
     * Clear authentication token
     */
    clearAuthToken(): void {
        this.httpClient.clearAuthToken();
    }

    setApiKey(apiKey: string): void {
        this.httpClient.setApiKey(apiKey);
    }

    clearApiKey(): void {
        this.httpClient.clearApiKey();
    }

    /**
     * Connect to WebSocket for real-time updates
     * @param token - Optional authentication token
     */
    connectWebSocket(token?: string): WebSocketClient {
        this.wsClient.connect(token);
        return this.wsClient;
    }

    /**
     * Disconnect WebSocket
     */
    disconnectWebSocket(): void {
        this.wsClient.disconnect();
    }

    /**
     * Subscribe to WebSocket events
     * @param event - Event name
     * @param callback - Event handler
     */
    on(event: WebSocketEvent, callback: (...args: any[]) => void): void {
        this.wsClient.on(event, callback);
    }

    /**
     * Unsubscribe from WebSocket events
     * @param event - Event name
     * @param callback - Optional specific handler to remove
     */
    off(event: WebSocketEvent, callback?: (...args: any[]) => void): void {
        if (callback) {
            this.wsClient.off(event, callback);
        } else {
            this.wsClient.removeAllListeners(event);
        }
    }

    /**
     * Subscribe to pair updates
     * @param pairAddress - Pair contract address
     */
    subscribeToPair(pairAddress: string): void {
        if (!this.wsClient.isConnected()) {
            this.connectWebSocket();
        }
        this.wsClient.subscribeToPair(pairAddress);
    }

    /**
     * Unsubscribe from pair updates
     * @param pairAddress - Pair contract address
     */
    unsubscribeFromPair(pairAddress: string): void {
        this.wsClient.unsubscribeFromPair(pairAddress);
    }

    /**
     * Check if WebSocket is connected
     */
    isWebSocketConnected(): boolean {
        return this.wsClient.isConnected();
    }
}

// Export everything
export * from './types';
export * from './spot-types';
export * from './utils';
export * from './spot-utils';
export * from './modules/auth';
export * from './modules/factory';
export * from './modules/router';
export * from './modules/pair';
export * from './modules/staking';
export * from './modules/rewards';
export * from './modules/wnative';
export * from './modules/tokens';
export * from './modules/market';
export * from './modules/orders';
export * from './modules/social';
export * from './modules/copytrade';
export * from './modules/agents';
export * from './modules/asymmetric/types';
export { AsymmetricModule } from './modules/asymmetric/AsymmetricClient';
export type {
    Strategy,
    StrategyType,
    StrategyRiskLevel,
    StrategyPerformancePoint,
    CreateStrategyInput,
    UpdateStrategyInput,
} from './modules/strategy';
export type { StrategyStatus as AiStrategyStatus } from './modules/strategy';
export { StrategyModule } from './modules/strategy';
export * from './modules/execution';
export { ExecutionModule } from './modules/execution';
export { WebSocketClient, WebSocketEvent } from './websocket-client';

// Default export
export default LunexSDK;
