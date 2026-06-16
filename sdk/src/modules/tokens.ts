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
  Pagination,
} from '../types';
import {
  formatAmountWithDecimals,
  parseAmountWithValidation,
  getTokenDecimals,
  COMMON_DECIMALS,
} from '../utils';
import { EndpointNotAvailableError } from '../errors';

export class TokensModule {
  constructor(private http: HttpClient) {}

  // ============================================
  // TOKEN INFO
  // ============================================

  /**
   * Get all listed tokens (token registry — GET /api/v1/tokens)
   *
   * Note: the registry endpoint filters by `verified`/`trusted` and does
   * not paginate, so `pagination` is `undefined` at runtime and the
   * page/limit/sort options are ignored server-side.
   * @param options - Filter and pagination options
   */
  async getTokens(options?: {
    page?: number;
    limit?: number;
    listed?: boolean;
    sort?: 'marketCap' | 'volume24h' | 'priceChange24h';
    order?: 'asc' | 'desc';
  }): Promise<{ tokens: TokenWithDecimals[]; pagination: Pagination }> {
    return this.http.get('/api/v1/tokens', options);
  }

  /**
   * Get token by address (token registry — GET /api/v1/tokens/:address)
   * @param address - Token contract address
   */
  async getToken(address: string): Promise<TokenWithDecimals> {
    return this.http.get(`/api/v1/tokens/${address}`);
  }

  /**
   * Get token decimals (derived from GET /api/v1/tokens/:address)
   * @param address - Token contract address
   */
  async getTokenDecimals(
    address: string,
  ): Promise<{ address: string; decimals: number; symbol: string }> {
    const token = await this.getToken(address);
    return {
      address,
      decimals: token.decimals,
      symbol: token.symbol,
    };
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
   * @deprecated spot-api does not expose `/public/native-assets` (this
   * call always returned HTTP 404). Native asset metadata is a chain-level
   * read via `@polkadot/api`. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getNativeAssets(): Promise<NativeAssetInfo[]> {
    throw new EndpointNotAvailableError(
      'tokens.getNativeAssets',
      'native asset metadata is a chain-level read. Query the Lunes node via @polkadot/api.',
    );
  }

  /**
   * Get native asset info
   * @param _assetId - Native asset ID
   * @deprecated spot-api does not expose `/public/native-asset/*` (this
   * call always returned HTTP 404). Native asset metadata is a chain-level
   * read via `@polkadot/api`. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getNativeAsset(_assetId: string): Promise<NativeAssetInfo> {
    throw new EndpointNotAvailableError(
      'tokens.getNativeAsset',
      'native asset metadata is a chain-level read. Query the Lunes node via @polkadot/api.',
    );
  }

  /**
   * Wrap native asset to PSP22 token
   * @param _params - Wrap parameters
   * @deprecated spot-api does not expose `/tokens/wrap` (this call always
   * returned HTTP 404). Wrapping is an on-chain transaction on the asset
   * wrapper contract that must be signed by the user's wallet. Always
   * throws {@link EndpointNotAvailableError}.
   */
  async wrapNativeAsset(
    _params: WrapParams,
  ): Promise<TransactionResult & { wrappedAmount: string }> {
    throw new EndpointNotAvailableError(
      'tokens.wrapNativeAsset',
      'wrapping a native asset is an on-chain transaction on the wrapper contract that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Unwrap PSP22 token to native asset
   * @param _params - Unwrap parameters
   * @deprecated spot-api does not expose `/tokens/unwrap` (this call
   * always returned HTTP 404). Unwrapping is an on-chain transaction on
   * the asset wrapper contract that must be signed by the user's wallet.
   * Always throws {@link EndpointNotAvailableError}.
   */
  async unwrapToNative(
    _params: UnwrapParams,
  ): Promise<TransactionResult & { nativeAmount: string }> {
    throw new EndpointNotAvailableError(
      'tokens.unwrapToNative',
      'unwrapping to a native asset is an on-chain transaction on the wrapper contract that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  // ============================================
  // BALANCES
  // ============================================

  /**
   * Get user balance for a token
   * @param _address - User address
   * @param _tokenAddress - Token address
   * @deprecated spot-api does not expose `/balances/*` endpoints (this
   * call always returned HTTP 404). Token balances are on-chain reads
   * (PSP22 `balance_of`). Agents can use `sdk.agents` portfolio
   * (GET /api/v1/trade/portfolio). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getBalance(
    _address: string,
    _tokenAddress: string,
  ): Promise<UserBalance> {
    throw new EndpointNotAvailableError(
      'tokens.getBalance',
      'token balances are on-chain reads (PSP22 balance_of). Query the chain via @polkadot/api-contract, or use the agent portfolio endpoint (GET /api/v1/trade/portfolio) for agent accounts.',
    );
  }

  /**
   * Get all user balances
   * @param _address - User address
   * @deprecated spot-api does not expose `/balances/*` endpoints (this
   * call always returned HTTP 404). Balances are on-chain reads. Agents
   * can use `sdk.agents` portfolio (GET /api/v1/trade/portfolio). Always
   * throws {@link EndpointNotAvailableError}.
   */
  async getAllBalances(_address: string): Promise<PortfolioSummary> {
    throw new EndpointNotAvailableError(
      'tokens.getAllBalances',
      'wallet balances are on-chain reads. Query the chain via @polkadot/api, or use the agent portfolio endpoint (GET /api/v1/trade/portfolio) for agent accounts.',
    );
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
  formatAmount(
    amount: string,
    decimals: number,
    maxDisplay?: number,
  ): FormattedAmount {
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
  formatAmountWithSymbol(
    amount: string,
    token: Token,
    maxDisplay?: number,
  ): string {
    const formatted = formatAmountWithDecimals(
      amount,
      token.decimals,
      maxDisplay,
    );
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
  validatePrecision(
    amount: string,
    decimals: number,
  ): { valid: boolean; error?: string } {
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
   * @param _address - Token address
   * @deprecated spot-api does not expose `/public/price/*` endpoints
   * (this call always returned HTTP 404). Prices are keyed by pair
   * symbol, not token address — use the pair ticker
   * (GET /api/v1/pairs/:symbol/ticker) via `sdk.market`. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getPrice(_address: string): Promise<{
    price: string;
    priceUSD: string;
    priceChange24h: string;
  }> {
    throw new EndpointNotAvailableError(
      'tokens.getPrice',
      'no per-token-address price endpoint exists. Prices are keyed by pair symbol: use GET /api/v1/pairs/:symbol/ticker via sdk.market.',
    );
  }

  /**
   * Get prices for multiple tokens
   * @param _addresses - Array of token addresses
   * @deprecated spot-api does not expose `/public/prices` (this call
   * always returned HTTP 404). Prices are keyed by pair symbol, not token
   * address — use the pair ticker (GET /api/v1/pairs/:symbol/ticker) via
   * `sdk.market`. Always throws {@link EndpointNotAvailableError}.
   */
  async getPrices(
    _addresses: string[],
  ): Promise<Record<string, { price: string; priceChange24h: string }>> {
    throw new EndpointNotAvailableError(
      'tokens.getPrices',
      'no per-token-address prices endpoint exists. Prices are keyed by pair symbol: use GET /api/v1/pairs/:symbol/ticker via sdk.market.',
    );
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
