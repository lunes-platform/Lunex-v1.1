import { HttpClient } from '../http-client';
import { Pair, Candle } from '../types';
import { EndpointNotAvailableError } from '../errors';

export class PairModule {
  constructor(private http: HttpClient) {}

  /**
   * Get detailed pair information
   * @param _address - Pair contract address
   * @returns Complete pair information
   * @deprecated spot-api does not expose `/pair/*` endpoints (this call
   * always returned HTTP 404). AMM pair state is an on-chain contract
   * read. For spot trading pairs use `sdk.market.getPairs()` /
   * `sdk.market.getTicker()` (GET /api/v1/pairs). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getInfo(_address: string): Promise<Pair> {
    throw new EndpointNotAvailableError(
      'pair.getInfo',
      'AMM pair state is an on-chain contract read. Query the pair contract via @polkadot/api-contract, or use sdk.market.getPairs() for spot trading pairs.',
    );
  }

  /**
   * Get pair reserves
   * @param _address - Pair contract address
   * @returns Current reserves and timestamp
   * @deprecated spot-api does not expose `/pair/*` endpoints (this call
   * always returned HTTP 404). Reserves are an on-chain read
   * (`get_reserves` on the pair contract). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getReserves(_address: string): Promise<{
    reserve0: string;
    reserve1: string;
    blockTimestampLast: number;
    price0CumulativeLast: string;
    price1CumulativeLast: string;
  }> {
    throw new EndpointNotAvailableError(
      'pair.getReserves',
      'pair reserves are an on-chain read (get_reserves on the pair contract). Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Get historical price data
   * @param _address - Pair contract address
   * @param _params - Time interval and range
   * @returns Array of candles
   * @deprecated spot-api does not expose `/pair/*` endpoints (this call
   * always returned HTTP 404). For candle history use
   * `sdk.market.getCandles()` (GET /api/v1/candles/:symbol), keyed by
   * pair symbol instead of contract address. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getHistory(
    _address: string,
    _params?: {
      interval?: '1h' | '4h' | '1d' | '1w';
      from?: number;
      to?: number;
    },
  ): Promise<{ candles: Candle[] }> {
    throw new EndpointNotAvailableError(
      'pair.getHistory',
      'no per-contract-address history endpoint exists. Use sdk.market.getCandles(symbol) (GET /api/v1/candles/:symbol), keyed by pair symbol.',
    );
  }

  /**
   * Get LP token balance for an address
   * @param _pairAddress - Pair contract address
   * @param _owner - Owner address
   * @returns LP balance and share information
   * @deprecated spot-api does not expose `/pair/*` endpoints (this call
   * always returned HTTP 404). LP balances are on-chain reads (PSP22
   * `balance_of` on the pair contract). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getLPBalance(
    _pairAddress: string,
    _owner: string,
  ): Promise<{
    balance: string;
    totalSupply: string;
    share: string;
    token0Amount: string;
    token1Amount: string;
    value: string;
  }> {
    throw new EndpointNotAvailableError(
      'pair.getLPBalance',
      'LP balances are on-chain reads (PSP22 balance_of / total_supply on the pair contract). Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Calculate current price from reserves
   * @param reserve0 - Reserve of token0
   * @param reserve1 - Reserve of token1
   * @returns Price of token0 in terms of token1
   */
  calculatePrice(reserve0: string, reserve1: string): number {
    return Number(reserve1) / Number(reserve0);
  }

  /**
   * Calculate LP token share percentage
   * @param lpBalance - LP token balance
   * @param totalSupply - Total LP supply
   * @returns Share percentage
   */
  calculateShare(lpBalance: string, totalSupply: string): number {
    if (totalSupply === '0') return 0;
    return (Number(lpBalance) / Number(totalSupply)) * 100;
  }
}
