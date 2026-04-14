import { HttpClient } from '../http-client';
import {
  Pair,
  PaginationParams,
  Pagination,
  TransactionResult,
  FactoryStats,
} from '../types';

export class FactoryModule {
  constructor(private http: HttpClient) {}

  /**
   * Get all trading pairs
   * @param params - Pagination and sorting parameters
   * @returns List of pairs with pagination
   */
  async getAllPairs(
    params?: PaginationParams & {
      sort?: 'createdAt' | 'volume' | 'liquidity';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ pairs: Pair[]; pagination: Pagination }> {
    return this.http.get('/factory/pairs', params);
  }

  /**
   * Get a specific pair by token addresses
   * @param tokenA - First token address
   * @param tokenB - Second token address
   * @returns Pair information
   */
  async getPairByTokens(tokenA: string, tokenB: string): Promise<Pair> {
    return this.http.get(`/factory/pair/${tokenA}/${tokenB}`);
  }

  /**
   * Create a new trading pair
   * @param tokenA - First token address
   * @param tokenB - Second token address
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with pair address
   */
  async createPair(
    tokenA: string,
    tokenB: string,
    gasLimit?: string,
  ): Promise<TransactionResult & { pairAddress: string }> {
    return this.http.post('/factory/pair', {
      tokenA,
      tokenB,
      gasLimit: gasLimit || '300000000000',
    });
  }

  /**
   * Get factory statistics
   * @returns Factory-wide statistics
   */
  async getStats(): Promise<FactoryStats> {
    return this.http.get('/factory/stats');
  }

  /**
   * Check if a pair exists
   * @param tokenA - First token address
   * @param tokenB - Second token address
   * @returns Boolean indicating if pair exists
   */
  async pairExists(tokenA: string, tokenB: string): Promise<boolean> {
    try {
      await this.getPairByTokens(tokenA, tokenB);
      return true;
    } catch (error: any) {
      if (error.code === 'PAIR_001') {
        return false;
      }
      throw error;
    }
  }
}
