import { HttpClient } from '../http-client';
import { Pair, Candle } from '../types';

export class PairModule {
  constructor(private http: HttpClient) {}

  /**
   * Get detailed pair information
   * @param address - Pair contract address
   * @returns Complete pair information
   */
  async getInfo(address: string): Promise<Pair> {
    return this.http.get(`/pair/${address}`);
  }

  /**
   * Get pair reserves
   * @param address - Pair contract address
   * @returns Current reserves and timestamp
   */
  async getReserves(address: string): Promise<{
    reserve0: string;
    reserve1: string;
    blockTimestampLast: number;
    price0CumulativeLast: string;
    price1CumulativeLast: string;
  }> {
    return this.http.get(`/pair/${address}/reserves`);
  }

  /**
   * Get historical price data
   * @param address - Pair contract address
   * @param params - Time interval and range
   * @returns Array of candles
   */
  async getHistory(
    address: string,
    params?: {
      interval?: '1h' | '4h' | '1d' | '1w';
      from?: number;
      to?: number;
    },
  ): Promise<{ candles: Candle[] }> {
    return this.http.get(`/pair/${address}/history`, params);
  }

  /**
   * Get LP token balance for an address
   * @param pairAddress - Pair contract address
   * @param owner - Owner address
   * @returns LP balance and share information
   */
  async getLPBalance(
    pairAddress: string,
    owner: string,
  ): Promise<{
    balance: string;
    totalSupply: string;
    share: string;
    token0Amount: string;
    token1Amount: string;
    value: string;
  }> {
    return this.http.get(`/pair/${pairAddress}/balance/${owner}`);
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
