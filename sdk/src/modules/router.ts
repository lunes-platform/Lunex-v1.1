import { HttpClient } from '../http-client';
import {
    Quote,
    LiquidityParams,
    RemoveLiquidityParams,
    SwapExactInParams,
    SwapExactOutParams,
    TransactionResult,
} from '../types';

export class RouterModule {
    constructor(private http: HttpClient) { }

    /**
     * Get a quote for a swap
     * @param amountIn - Input amount
     * @param path - Array of token addresses
     * @returns Quote with price impact and route
     */
    async getQuote(amountIn: string, path: string[]): Promise<Quote> {
        return this.http.get('/router/quote', {
            amountIn,
            path: JSON.stringify(path),
        });
    }

    /**
     * Add liquidity to a pair
     * @param params - Liquidity parameters
     * @returns Transaction result with amounts and liquidity tokens
     */
    async addLiquidity(params: LiquidityParams): Promise<
        TransactionResult & {
            amountA: string;
            amountB: string;
            liquidity: string;
        }
    > {
        return this.http.post('/router/add-liquidity', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
    }

    /**
     * Remove liquidity from a pair
     * @param params - Remove liquidity parameters
     * @returns Transaction result with removed amounts
     */
    async removeLiquidity(params: RemoveLiquidityParams): Promise<
        TransactionResult & {
            amountA: string;
            amountB: string;
        }
    > {
        return this.http.post('/router/remove-liquidity', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
    }

    /**
     * Swap exact tokens for tokens
     * @param params - Swap parameters
     * @returns Transaction result with amounts and price impact
     */
    async swapExactTokensForTokens(params: SwapExactInParams): Promise<
        TransactionResult & {
            amountIn: string;
            amountOut: string;
            priceImpact: string;
            executionPrice: string;
        }
    > {
        return this.http.post('/router/swap-exact-in', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
    }

    /**
     * Swap tokens for exact tokens
     * @param params - Swap parameters
     * @returns Transaction result with amounts
     */
    async swapTokensForExactTokens(params: SwapExactOutParams): Promise<
        TransactionResult & {
            amountIn: string;
            amountOut: string;
        }
    > {
        return this.http.post('/router/swap-exact-out', {
            ...params,
            gasLimit: params.gasLimit || '500000000000',
        });
    }

    /**
     * Calculate slippage-adjusted minimum amount
     * @param amount - Original amount
     * @param slippagePercent - Slippage tolerance (e.g., 1 for 1%)
     * @returns Minimum amount after slippage
     */
    calculateMinAmount(amount: string, slippagePercent: number): string {
        const amountBigInt = BigInt(amount);
        const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 100));
        return (amountBigInt * slippageMultiplier / BigInt(10000)).toString();
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
        reserveOut: string
    ): number {
        const spotPrice = Number(reserveOut) / Number(reserveIn);
        const executionPrice = Number(amountOut) / Number(amountIn);
        const priceImpact = ((spotPrice - executionPrice) / spotPrice) * 100;
        return Math.abs(priceImpact);
    }
}
