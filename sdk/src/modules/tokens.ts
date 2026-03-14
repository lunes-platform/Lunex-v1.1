/**
 * Tokens Module - Complete token management for frontend
 */

import { HttpClient } from '../http-client';
import {
    Token,
    TokenWithDecimals,
    NativeAssetInfo,
    UserBalance,
    PortfolioSummary,
    FormattedAmount,
    ParsedAmount,
    WrapParams,
    UnwrapParams,
    TransactionResult,
} from '../types';
import {
    formatAmountWithDecimals,
    parseAmountWithValidation,
    getTokenDecimals,
    COMMON_DECIMALS,
} from '../utils';

export class TokensModule {
    constructor(private http: HttpClient) { }

    // ============================================
    // TOKEN INFO
    // ============================================

    /**
     * Get all listed tokens
     * @param options - Filter and pagination options
     */
    async getTokens(options?: {
        page?: number;
        limit?: number;
        listed?: boolean;
        sort?: 'marketCap' | 'volume24h' | 'priceChange24h';
        order?: 'asc' | 'desc';
    }): Promise<{ tokens: TokenWithDecimals[]; pagination: any }> {
        return this.http.get('/public/tokens', options);
    }

    /**
     * Get token by address
     * @param address - Token contract address
     */
    async getToken(address: string): Promise<TokenWithDecimals> {
        return this.http.get(`/public/token/${address}`);
    }

    /**
     * Get token decimals
     * @param address - Token contract address
     */
    async getTokenDecimals(address: string): Promise<{ address: string; decimals: number; symbol: string }> {
        return this.http.get(`/public/token/${address}/decimals`);
    }

    /**
     * Get decimals for known token symbol (local, no API call)
     * @param symbol - Token symbol
     */
    getKnownDecimals(symbol: string): number | undefined {
        return getTokenDecimals(symbol);
    }

    /**
     * Get all known token decimals (local)
     */
    getKnownDecimalsRegistry(): Record<string, number> {
        return { ...COMMON_DECIMALS };
    }

    // ============================================
    // NATIVE ASSETS (Lunes Blockchain)
    // ============================================

    /**
     * Get all native assets available on Lunes
     */
    async getNativeAssets(): Promise<NativeAssetInfo[]> {
        return this.http.get('/public/native-assets');
    }

    /**
     * Get native asset info
     * @param assetId - Native asset ID
     */
    async getNativeAsset(assetId: string): Promise<NativeAssetInfo> {
        return this.http.get(`/public/native-asset/${assetId}`);
    }

    /**
     * Wrap native asset to PSP22 token
     * @param params - Wrap parameters
     */
    async wrapNativeAsset(params: WrapParams): Promise<TransactionResult & { wrappedAmount: string }> {
        return this.http.post('/tokens/wrap', params);
    }

    /**
     * Unwrap PSP22 token to native asset
     * @param params - Unwrap parameters
     */
    async unwrapToNative(params: UnwrapParams): Promise<TransactionResult & { nativeAmount: string }> {
        return this.http.post('/tokens/unwrap', params);
    }

    // ============================================
    // BALANCES
    // ============================================

    /**
     * Get user balance for a token
     * @param address - User address
     * @param tokenAddress - Token address
     */
    async getBalance(address: string, tokenAddress: string): Promise<UserBalance> {
        const response = await this.http.get(`/balances/${address}/${tokenAddress}`);
        return this.formatUserBalance(response);
    }

    /**
     * Get all user balances
     * @param address - User address
     */
    async getAllBalances(address: string): Promise<PortfolioSummary> {
        const response = await this.http.get<{
            balances: any[];
            totalValueUSD: string;
            change24h: string;
            change24hPercent: string;
        }>(`/balances/${address}`);
        return {
            totalValueUSD: response.totalValueUSD,
            change24h: response.change24h,
            change24hPercent: response.change24hPercent,
            balances: response.balances.map((b: any) => this.formatUserBalance(b)),
        };
    }

    /**
     * Format a balance with proper decimals
     */
    private formatUserBalance(data: any): UserBalance {
        const token = data.token as TokenWithDecimals;
        return {
            token,
            balance: data.balance,
            formattedBalance: formatAmountWithDecimals(data.balance, token.decimals, 6),
            valueUSD: data.valueUSD || '0',
        };
    }

    // ============================================
    // FORMATTING HELPERS
    // ============================================

    /**
     * Format raw amount for display
     * @param amount - Raw amount in smallest unit
     * @param decimals - Token decimals
     * @param maxDisplay - Max decimal places to show
     */
    formatAmount(amount: string, decimals: number, maxDisplay?: number): FormattedAmount {
        return {
            raw: amount,
            formatted: formatAmountWithDecimals(amount, decimals, maxDisplay),
            fullPrecision: formatAmountWithDecimals(amount, decimals),
            decimals,
        };
    }

    /**
     * Format amount with token symbol
     * @param amount - Raw amount
     * @param token - Token info
     * @param maxDisplay - Max decimal places
     */
    formatAmountWithSymbol(amount: string, token: Token, maxDisplay?: number): string {
        const formatted = formatAmountWithDecimals(amount, token.decimals, maxDisplay);
        return `${formatted} ${token.symbol}`;
    }

    /**
     * Parse user input to raw amount
     * @param input - User input like "123.456"
     * @param decimals - Token decimals
     */
    parseUserInput(input: string, decimals: number): ParsedAmount {
        const result = parseAmountWithValidation(input, decimals);
        return {
            success: result.success,
            input,
            parsed: result.success ? result.value : undefined,
            decimals,
            error: result.success ? undefined : result.error,
        };
    }

    /**
     * Validate amount has enough precision for token
     * @param amount - User input
     * @param decimals - Token decimals
     */
    validatePrecision(amount: string, decimals: number): { valid: boolean; error?: string } {
        const parts = amount.split('.');
        if (parts.length === 1) return { valid: true };

        const decimalPart = parts[1];
        if (decimalPart.length > decimals) {
            return {
                valid: false,
                error: `Too many decimal places. ${decimals} max allowed.`,
            };
        }
        return { valid: true };
    }

    // ============================================
    // PRICE & VALUE HELPERS
    // ============================================

    /**
     * Get current price for token
     * @param address - Token address
     */
    async getPrice(address: string): Promise<{
        price: string;
        priceUSD: string;
        priceChange24h: string;
    }> {
        return this.http.get(`/public/price/${address}`);
    }

    /**
     * Get prices for multiple tokens
     * @param addresses - Array of token addresses
     */
    async getPrices(addresses: string[]): Promise<Record<string, { price: string; priceChange24h: string }>> {
        return this.http.get('/public/prices', {
            addresses: addresses.join(','),
        });
    }

    /**
     * Calculate USD value of amount
     * @param amount - Raw amount
     * @param token - Token with price info
     */
    calculateUSDValue(amount: string, token: TokenWithDecimals): string {
        if (!token.priceUSD) return '0';
        const amountNum = Number(amount) / Math.pow(10, token.decimals);
        const priceNum = Number(token.priceUSD);
        return (amountNum * priceNum).toFixed(2);
    }
}
