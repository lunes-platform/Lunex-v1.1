// Lunex DEX SDK - TypeScript/JavaScript
// Complete SDK for interacting with Lunex DEX API

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { io, Socket } from 'socket.io-client';

// ==========================================
// TYPES & INTERFACES
// ==========================================

export interface Token {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
}

export interface Pair {
    address: string;
    token0: Token;
    token1: Token;
    reserve0: string;
    reserve1: string;
    totalSupply: string;
    price0: string;
    price1: string;
    volume24h: string;
    tvl: string;
    apr?: string;
}

export interface Quote {
    amountIn: string;
    amountOut: string;
    path: string[];
    priceImpact: string;
    minimumReceived: string;
    fee: string;
    route: RouteStep[];
}

export interface RouteStep {
    pair: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
}

export interface TransactionResult {
    transactionHash: string;
    blockNumber: number;
    gasUsed: string;
    status: string;
}

export interface StakePosition {
    amount: string;
    startTime: number;
    duration: number;
    endTime: number;
    tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
    pendingRewards: string;
    claimedRewards: string;
    votingPower: string;
    active: boolean;
}

export interface Proposal {
    id: number;
    name: string;
    description: string;
    tokenAddress: string;
    proposer: string;
    votesFor: string;
    votesAgainst: string;
    votingDeadline: number;
    executed: boolean;
    active: boolean;
}

export interface TradingPosition {
    totalVolume: string;
    monthlyVolume: string;
    dailyVolume: string;
    tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
    multiplier: string;
    pendingRewards: string;
    claimedRewards: string;
    tradeCount: number;
}

export interface LunexConfig {
    baseURL: string;
    timeout?: number;
    wsURL?: string;
}

export interface AuthTokens {
    token: string;
    refreshToken: string;
    expiresIn: number;
}

// ==========================================
// MAIN SDK CLASS
// ==========================================

export class LunexSDK {
    private http: AxiosInstance;
    private wsURL: string;
    private socket: Socket | null = null;
    private authToken: string | null = null;

    constructor(config: LunexConfig) {
        this.http = axios.create({
            baseURL: config.baseURL,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        this.wsURL = config.wsURL || config.baseURL.replace('http', 'ws');

        // Response interceptor
        this.http.interceptors.response.use(
            (response) => response.data,
            (error) => {
                throw this.handleError(error);
            }
        );

        // Request interceptor
        this.http.interceptors.request.use((config) => {
            if (this.authToken) {
                config.headers.Authorization = `Bearer ${this.authToken}`;
            }
            return config;
        });
    }

    // ==========================================
    // AUTHENTICATION
    // ==========================================

    async getNonce(address: string): Promise<{ nonce: string; expiresIn: number }> {
        const response = await this.http.post('/auth/nonce', { address });
        return response.data;
    }

    async login(
        address: string,
        signature: string,
        nonce: string
    ): Promise<AuthTokens> {
        const response = await this.http.post('/auth/login', {
            address,
            signature,
            nonce,
        });

        this.authToken = response.data.token;
        return response.data;
    }

    setAuthToken(token: string): void {
        this.authToken = token;
    }

    // ==========================================
    // FACTORY API
    // ==========================================

    async getAllPairs(params?: {
        page?: number;
        limit?: number;
        sort?: 'createdAt' | 'volume' | 'liquidity';
        order?: 'asc' | 'desc';
    }): Promise<{ pairs: Pair[]; pagination: any }> {
        const response = await this.http.get('/factory/pairs', { params });
        return response.data;
    }

    async getPairByTokens(tokenA: string, tokenB: string): Promise<Pair> {
        const response = await this.http.get(`/factory/pair/${tokenA}/${tokenB}`);
        return response.data;
    }

    async createPair(
        tokenA: string,
        tokenB: string,
        gasLimit?: string
    ): Promise<TransactionResult & { pairAddress: string }> {
        const response = await this.http.post('/factory/pair', {
            tokenA,
            tokenB,
            gasLimit: gasLimit || '300000000000',
        });
        return response.data;
    }

    async getFactoryStats(): Promise<{
        totalPairs: number;
        totalVolume24h: string;
        totalLiquidity: string;
    }> {
        const response = await this.http.get('/factory/stats');
        return response.data;
    }

    // ==========================================
    // ROUTER API
    // ==========================================

    async getQuote(amountIn: string, path: string[]): Promise<Quote> {
        const response = await this.http.get('/router/quote', {
            params: {
                amountIn,
                path: JSON.stringify(path),
            },
        });
        return response.data;
    }

    async addLiquidity(params: {
        tokenA: string;
        tokenB: string;
        amountADesired: string;
        amountBDesired: string;
        amountAMin: string;
        amountBMin: string;
        to: string;
        deadline: number;
        gasLimit?: string;
    }): Promise<TransactionResult & {
        amountA: string;
        amountB: string;
        liquidity: string;
    }> {
        const response = await this.http.post('/router/add-liquidity', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
        return response.data;
    }

    async removeLiquidity(params: {
        tokenA: string;
        tokenB: string;
        liquidity: string;
        amountAMin: string;
        amountBMin: string;
        to: string;
        deadline: number;
        gasLimit?: string;
    }): Promise<TransactionResult & {
        amountA: string;
        amountB: string;
    }> {
        const response = await this.http.post('/router/remove-liquidity', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
        return response.data;
    }

    async swapExactTokensForTokens(params: {
        amountIn: string;
        amountOutMin: string;
        path: string[];
        to: string;
        deadline: number;
        gasLimit?: string;
    }): Promise<TransactionResult & {
        amountIn: string;
        amountOut: string;
        priceImpact: string;
    }> {
        const response = await this.http.post('/router/swap-exact-in', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
        return response.data;
    }

    async swapTokensForExactTokens(params: {
        amountOut: string;
        amountInMax: string;
        path: string[];
        to: string;
        deadline: number;
        gasLimit?: string;
    }): Promise<TransactionResult & {
        amountIn: string;
        amountOut: string;
    }> {
        const response = await this.http.post('/router/swap-exact-out', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
        return response.data;
    }

    // ==========================================
    // PAIR API
    // ==========================================

    async getPairInfo(address: string): Promise<Pair> {
        const response = await this.http.get(`/pair/${address}`);
        return response.data;
    }

    async getPairReserves(address: string): Promise<{
        reserve0: string;
        reserve1: string;
        blockTimestampLast: number;
    }> {
        const response = await this.http.get(`/pair/${address}/reserves`);
        return response.data;
    }

    async getPairHistory(
        address: string,
        params?: {
            interval?: '1h' | '4h' | '1d' | '1w';
            from?: number;
            to?: number;
        }
    ): Promise<{ candles: any[] }> {
        const response = await this.http.get(`/pair/${address}/history`, { params });
        return response.data;
    }

    async getLPBalance(pairAddress: string, owner: string): Promise<{
        balance: string;
        totalSupply: string;
        share: string;
        token0Amount: string;
        token1Amount: string;
    }> {
        const response = await this.http.get(`/pair/${pairAddress}/balance/${owner}`);
        return response.data;
    }

    // ==========================================
    // WNATIVE API
    // ==========================================

    async wrapLunes(amount: string, gasLimit?: string): Promise<TransactionResult> {
        const response = await this.http.post('/wnative/deposit', {
            amount,
            gasLimit: gasLimit || '200000000000',
        });
        return response.data;
    }

    async unwrapWLunes(amount: string, gasLimit?: string): Promise<TransactionResult> {
        const response = await this.http.post('/wnative/withdraw', {
            amount,
            gasLimit: gasLimit || '200000000000',
        });
        return response.data;
    }

    async getWNativeInfo(): Promise<{
        address: string;
        totalSupply: string;
        nativeBalance: string;
        isHealthy: boolean;
    }> {
        const response = await this.http.get('/wnative/info');
        return response.data;
    }

    async getWNativeBalance(address: string): Promise<{
        wlunesBalance: string;
        lunesBalance: string;
    }> {
        const response = await this.http.get(`/wnative/balance/${address}`);
        return response.data;
    }

    // ==========================================
    // STAKING API
    // ==========================================

    async stake(
        amount: string,
        duration: number,
        gasLimit?: string
    ): Promise<TransactionResult & {
        tier: string;
        estimatedRewards: string;
        apr: string;
    }> {
        const response = await this.http.post('/staking/stake', {
            amount,
            duration,
            gasLimit: gasLimit || '300000000000',
        });
        return response.data;
    }

    async unstake(gasLimit?: string): Promise<TransactionResult & {
        amount: string;
        rewards: string;
        penalty: string;
    }> {
        const response = await this.http.post('/staking/unstake', {
            gasLimit: gasLimit || '300000000000',
        });
        return response.data;
    }

    async claimStakingRewards(gasLimit?: string): Promise<TransactionResult & {
        rewards: string;
    }> {
        const response = await this.http.post('/staking/claim', {
            gasLimit: gasLimit || '200000000000',
        });
        return response.data;
    }

    async getStakingPosition(address: string): Promise<StakePosition> {
        const response = await this.http.get(`/staking/position/${address}`);
        return response.data;
    }

    async getStakingStats(): Promise<{
        totalStaked: string;
        totalRewardsDistributed: string;
        activeStakers: number;
        averageAPR: string;
    }> {
        const response = await this.http.get('/staking/stats');
        return response.data;
    }

    async createProposal(params: {
        name: string;
        description: string;
        tokenAddress: string;
        fee: string;
        gasLimit?: string;
    }): Promise<TransactionResult & {
        proposalId: number;
        votingDeadline: number;
    }> {
        const response = await this.http.post('/staking/proposal', {
            ...params,
            gasLimit: params.gasLimit || '400000000000',
        });
        return response.data;
    }

    async voteOnProposal(
        proposalId: number,
        inFavor: boolean,
        gasLimit?: string
    ): Promise<TransactionResult & {
        votePower: string;
    }> {
        const response = await this.http.post('/staking/vote', {
            proposalId,
            inFavor,
            gasLimit: gasLimit || '200000000000',
        });
        return response.data;
    }

    async executeProposal(proposalId: number, gasLimit?: string): Promise<TransactionResult & {
        approved: boolean;
        votesFor: string;
        votesAgainst: string;
    }> {
        const response = await this.http.post(`/staking/proposal/${proposalId}/execute`, {
            gasLimit: gasLimit || '300000000000',
        });
        return response.data;
    }

    async getAllProposals(params?: {
        status?: 'active' | 'executed' | 'all';
        page?: number;
        limit?: number;
    }): Promise<{ proposals: Proposal[]; pagination: any }> {
        const response = await this.http.get('/staking/proposals', { params });
        return response.data;
    }

    async getProposal(id: number): Promise<Proposal> {
        const response = await this.http.get(`/staking/proposal/${id}`);
        return response.data;
    }

    async isTokenApproved(tokenAddress: string): Promise<{
        approved: boolean;
        approvedAt?: string;
        method?: string;
    }> {
        const response = await this.http.get(`/staking/token/${tokenAddress}/approved`);
        return response.data;
    }

    // ==========================================
    // TRADING REWARDS API
    // ==========================================

    async getTradingPosition(address: string): Promise<TradingPosition> {
        const response = await this.http.get(`/rewards/position/${address}`);
        return response.data;
    }

    async claimTradingRewards(gasLimit?: string): Promise<TransactionResult & {
        amount: string;
    }> {
        const response = await this.http.post('/rewards/claim', {
            gasLimit: gasLimit || '200000000000',
        });
        return response.data;
    }

    async getRewardsStats(): Promise<{
        rewardsPool: string;
        activeTraders: number;
        totalDistributed: string;
        averageAPR: string;
    }> {
        const response = await this.http.get('/rewards/stats');
        return response.data;
    }

    async getLeaderboard(params?: {
        period?: 'daily' | 'weekly' | 'monthly' | 'all-time';
        limit?: number;
    }): Promise<{
        period: string;
        leaderboard: Array<{
            rank: number;
            address: string;
            volume: string;
            tier: string;
            rewards: string;
        }>;
    }> {
        const response = await this.http.get('/rewards/leaderboard', { params });
        return response.data;
    }

    // ==========================================
    // WEBSOCKET
    // ==========================================

    connectWebSocket(): Socket {
        if (this.socket) {
            return this.socket;
        }

        this.socket = io(this.wsURL, {
            auth: {
                token: this.authToken ? `Bearer ${this.authToken}` : '',
            },
        });

        this.socket.on('connect', () => {
            console.log('WebSocket connected');
        });

        this.socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
        });

        return this.socket;
    }

    disconnectWebSocket(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }

    on(event: string, callback: (data: any) => void): void {
        if (!this.socket) {
            this.connectWebSocket();
        }
        this.socket?.on(event, callback);
    }

    off(event: string): void {
        this.socket?.off(event);
    }

    subscribeToPair(pairAddress: string): void {
        this.socket?.emit('subscribe:pair', { pairAddress });
    }

    // ==========================================
    // HELPER METHODS
    // ==========================================

    private handleError(error: any): Error {
        if (error.response) {
            const apiError = error.response.data.error;
            const message = apiError?.message || 'API Error';
            const newError = new Error(message);
            (newError as any).code = apiError?.code;
            (newError as any).details = apiError?.details;
            return newError;
        }
        return error;
    }

    calculateDeadline(minutesFromNow: number): number {
        return Math.floor(Date.now() / 1000) + minutesFromNow * 60;
    }

    formatAmount(amount: string, decimals: number): string {
        return (BigInt(amount) / BigInt(10 ** decimals)).toString();
    }

    parseAmount(amount: string, decimals: number): string {
        return (BigInt(amount) * BigInt(10 ** decimals)).toString();
    }
}

// ==========================================
// EXPORT
// ==========================================

export default LunexSDK;
