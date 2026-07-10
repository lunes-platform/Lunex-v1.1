import { HttpClient } from '../http-client';
import {
  Quote,
  LiquidityParams,
  RemoveLiquidityParams,
  SwapExactInParams,
  SwapExactOutParams,
  TransactionResult,
} from '../types';
import { EndpointNotAvailableError } from '../errors';

export class RouterModule {
  constructor(private http: HttpClient) {}

  /**
   * Get a quote for a swap
   * @param _amountIn - Input amount
   * @param _path - Array of token addresses
   * @returns Quote with price impact and route
   * @deprecated spot-api does not expose `/router/*` endpoints (this call
   * always returned HTTP 404). The REST quote endpoint is
   * `GET /api/v1/route/quote` and uses a different contract
   * (`pairSymbol`, `side`, `amountIn`) that is incompatible with this
   * token-address-path signature. Path-based AMM quoting is an on-chain
   * router-contract read. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getQuote(_amountIn: string, _path: string[]): Promise<Quote> {
    throw new EndpointNotAvailableError(
      'router.getQuote',
      'path-based AMM quoting is an on-chain router-contract read. For REST quotes use GET /api/v1/route/quote?pairSymbol=...&side=BUY|SELL&amountIn=... (different contract, keyed by pair symbol).',
    );
  }

  /**
   * Add liquidity to a pair
   * @param _params - Liquidity parameters
   * @returns Transaction result with amounts and liquidity tokens
   * @deprecated spot-api does not expose `/router/*` endpoints (this call
   * always returned HTTP 404). Adding liquidity is an on-chain
   * transaction (`add_liquidity` on the router contract) that must be
   * signed by the user's wallet. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async addLiquidity(_params: LiquidityParams): Promise<
    TransactionResult & {
      amountA: string;
      amountB: string;
      liquidity: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'router.addLiquidity',
      'adding liquidity is an on-chain transaction (add_liquidity on the router contract) that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Remove liquidity from a pair
   * @param _params - Remove liquidity parameters
   * @returns Transaction result with removed amounts
   * @deprecated spot-api does not expose `/router/*` endpoints (this call
   * always returned HTTP 404). Removing liquidity is an on-chain
   * transaction (`remove_liquidity` on the router contract) that must be
   * signed by the user's wallet. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async removeLiquidity(_params: RemoveLiquidityParams): Promise<
    TransactionResult & {
      amountA: string;
      amountB: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'router.removeLiquidity',
      'removing liquidity is an on-chain transaction (remove_liquidity on the router contract) that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Swap exact tokens for tokens
   * @param _params - Swap parameters
   * @returns Transaction result with amounts and price impact
   * @deprecated spot-api does not expose `/router/*` endpoints (this call
   * always returned HTTP 404). Path-based AMM swaps are on-chain router
   * transactions signed by the user's wallet. The REST swap endpoint is
   * `POST /api/v1/route/swap` (agent API key; `pairSymbol`/`side`
   * payload — see `sdk.agents`), which is incompatible with this
   * signature. Always throws {@link EndpointNotAvailableError}.
   */
  async swapExactTokensForTokens(_params: SwapExactInParams): Promise<
    TransactionResult & {
      amountIn: string;
      amountOut: string;
      priceImpact: string;
      executionPrice: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'router.swapExactTokensForTokens',
      'path-based AMM swaps are on-chain router transactions signed by the wallet. For REST swaps use POST /api/v1/route/swap (agent API key, pairSymbol/side payload — see sdk.agents).',
    );
  }

  /**
   * Swap tokens for exact tokens
   * @param _params - Swap parameters
   * @returns Transaction result with amounts
   * @deprecated spot-api does not expose `/router/*` endpoints (this call
   * always returned HTTP 404). Path-based AMM swaps are on-chain router
   * transactions signed by the user's wallet. The REST swap endpoint is
   * `POST /api/v1/route/swap` (agent API key; `pairSymbol`/`side`
   * payload — see `sdk.agents`), which is incompatible with this
   * signature. Always throws {@link EndpointNotAvailableError}.
   */
  async swapTokensForExactTokens(_params: SwapExactOutParams): Promise<
    TransactionResult & {
      amountIn: string;
      amountOut: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'router.swapTokensForExactTokens',
      'path-based AMM swaps are on-chain router transactions signed by the wallet. For REST swaps use POST /api/v1/route/swap (agent API key, pairSymbol/side payload — see sdk.agents).',
    );
  }

  /**
   * Calculate slippage-adjusted minimum amount
   * @param amount - Original amount
   * @param slippagePercent - Slippage tolerance (e.g., 1 for 1%)
   * @returns Minimum amount after slippage
   */
  calculateMinAmount(amount: string, slippagePercent: number): string {
    const amountBigInt = BigInt(amount);
    const slippageMultiplier = BigInt(
      Math.floor((100 - slippagePercent) * 100),
    );
    return ((amountBigInt * slippageMultiplier) / BigInt(10000)).toString();
  }

  /**
   * Calculate price impact
   * @param amountIn - Input amount
   * @param amountOut - Output amount
   * @param reserveIn - Reserve of input token
   * @param reserveOut - Reserve of output token
   * @returns Price impact percentage
   */
  calculatePriceImpact(
    amountIn: string,
    amountOut: string,
    reserveIn: string,
    reserveOut: string,
  ): number {
    const spotPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;
    return Math.abs(priceImpact);
  }
}
