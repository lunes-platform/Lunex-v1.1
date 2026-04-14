import { HttpClient } from '../http-client';
import { TransactionResult, WNativeInfo } from '../types';

export class WNativeModule {
  constructor(private http: HttpClient) {}

  /**
   * Wrap LUNES to WLUNES
   * @param amount - Amount of LUNES to wrap
   * @param gasLimit - Optional gas limit
   * @returns Transaction result
   */
  async wrap(
    amount: string,
    gasLimit?: string,
  ): Promise<
    TransactionResult & {
      amount: string;
      wlunes: string;
    }
  > {
    return this.http.post('/wnative/deposit', {
      amount,
      gasLimit: gasLimit || '200000000000',
    });
  }

  /**
   * Unwrap WLUNES to LUNES
   * @param amount - Amount of WLUNES to unwrap
   * @param gasLimit - Optional gas limit
   * @returns Transaction result
   */
  async unwrap(
    amount: string,
    gasLimit?: string,
  ): Promise<
    TransactionResult & {
      amount: string;
      lunes: string;
    }
  > {
    return this.http.post('/wnative/withdraw', {
      amount,
      gasLimit: gasLimit || '200000000000',
    });
  }

  /**
   * Get WLUNES contract information
   * @returns WLUNES token details
   */
  async getInfo(): Promise<WNativeInfo> {
    return this.http.get('/wnative/info');
  }

  /**
   * Get balances for an address
   * @param address - User address
   * @returns WLUNES and LUNES balances
   */
  async getBalance(address: string): Promise<{
    wlunesBalance: string;
    lunesBalance: string;
    totalValue: string;
  }> {
    return this.http.get(`/wnative/balance/${address}`);
  }

  /**
   * Check if WNATIVE contract is healthy (1:1 backing)
   * @returns Health status
   */
  async isHealthy(): Promise<boolean> {
    const info = await this.getInfo();
    return info.isHealthy;
  }
}
