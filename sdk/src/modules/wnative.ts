import { HttpClient } from '../http-client';
import { TransactionResult, WNativeInfo } from '../types';
import { EndpointNotAvailableError } from '../errors';

export class WNativeModule {
  constructor(private http: HttpClient) {}

  /**
   * Wrap LUNES to WLUNES
   * @param _amount - Amount of LUNES to wrap
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result
   * @deprecated spot-api does not expose `/wnative/*` endpoints (this call
   * always returned HTTP 404). Wrapping is an on-chain transaction
   * (`deposit` on the wnative contract) that must be signed by the user's
   * wallet. Always throws {@link EndpointNotAvailableError}.
   */
  async wrap(
    _amount: string,
    _gasLimit?: string,
  ): Promise<
    TransactionResult & {
      amount: string;
      wlunes: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'wnative.wrap',
      'wrapping LUNES is an on-chain transaction (deposit on the wnative contract) that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Unwrap WLUNES to LUNES
   * @param _amount - Amount of WLUNES to unwrap
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result
   * @deprecated spot-api does not expose `/wnative/*` endpoints (this call
   * always returned HTTP 404). Unwrapping is an on-chain transaction
   * (`withdraw` on the wnative contract) that must be signed by the user's
   * wallet. Always throws {@link EndpointNotAvailableError}.
   */
  async unwrap(
    _amount: string,
    _gasLimit?: string,
  ): Promise<
    TransactionResult & {
      amount: string;
      lunes: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'wnative.unwrap',
      'unwrapping WLUNES is an on-chain transaction (withdraw on the wnative contract) that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Get WLUNES contract information
   * @returns WLUNES token details
   * @deprecated spot-api does not expose `/wnative/*` endpoints (this call
   * always returned HTTP 404). Contract info is an on-chain read on the
   * wnative contract. Always throws {@link EndpointNotAvailableError}.
   */
  async getInfo(): Promise<WNativeInfo> {
    throw new EndpointNotAvailableError(
      'wnative.getInfo',
      'wnative contract info is an on-chain read. Query the wnative contract via @polkadot/api-contract.',
    );
  }

  /**
   * Get balances for an address
   * @param _address - User address
   * @returns WLUNES and LUNES balances
   * @deprecated spot-api does not expose `/wnative/*` endpoints (this call
   * always returned HTTP 404). Balances are on-chain reads (PSP22
   * `balance_of` + native balance). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getBalance(_address: string): Promise<{
    wlunesBalance: string;
    lunesBalance: string;
    totalValue: string;
  }> {
    throw new EndpointNotAvailableError(
      'wnative.getBalance',
      'WLUNES/LUNES balances are on-chain reads (PSP22 balance_of + system account balance). Query the chain via @polkadot/api.',
    );
  }

  /**
   * Check if WNATIVE contract is healthy (1:1 backing)
   * @returns Health status
   * @deprecated Depends on `/wnative/info`, which spot-api never exposed.
   * Always throws {@link EndpointNotAvailableError}.
   */
  async isHealthy(): Promise<boolean> {
    throw new EndpointNotAvailableError(
      'wnative.isHealthy',
      'wnative health (1:1 backing) is an on-chain read. Query the wnative contract via @polkadot/api-contract.',
    );
  }
}
