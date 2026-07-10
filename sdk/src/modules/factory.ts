import { HttpClient } from '../http-client';
import {
  Pair,
  PaginationParams,
  Pagination,
  TransactionResult,
  FactoryStats,
} from '../types';
import { EndpointNotAvailableError } from '../errors';

export class FactoryModule {
  constructor(private http: HttpClient) {}

  /**
   * Get all trading pairs
   * @param _params - Pagination and sorting parameters
   * @returns List of pairs with pagination
   * @deprecated spot-api does not expose `/factory/*` endpoints (this call
   * always returned HTTP 404). AMM factory pairs are an on-chain contract
   * concern — query the factory contract via `@polkadot/api-contract`.
   * For the spot trading-pair registry use `sdk.market.getPairs()`
   * (GET /api/v1/pairs). Always throws {@link EndpointNotAvailableError}.
   */
  async getAllPairs(
    _params?: PaginationParams & {
      sort?: 'createdAt' | 'volume' | 'liquidity';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ pairs: Pair[]; pagination: Pagination }> {
    throw new EndpointNotAvailableError(
      'factory.getAllPairs',
      'AMM factory pairs live on-chain (factory contract). Query the contract directly, or use sdk.market.getPairs() for the spot trading-pair registry (GET /api/v1/pairs).',
    );
  }

  /**
   * Get a specific pair by token addresses
   * @param _tokenA - First token address
   * @param _tokenB - Second token address
   * @returns Pair information
   * @deprecated spot-api does not expose `/factory/*` endpoints (this call
   * always returned HTTP 404). Resolving a pair by token addresses is an
   * on-chain factory-contract read (`get_pair`). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async getPairByTokens(_tokenA: string, _tokenB: string): Promise<Pair> {
    throw new EndpointNotAvailableError(
      'factory.getPairByTokens',
      'resolving a pair by token addresses is an on-chain factory-contract read (get_pair). Query the factory contract via @polkadot/api-contract.',
    );
  }

  /**
   * Create a new trading pair
   * @param _tokenA - First token address
   * @param _tokenB - Second token address
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with pair address
   * @deprecated spot-api does not expose `/factory/*` endpoints (this call
   * always returned HTTP 404). Creating a pair is an on-chain transaction
   * (`create_pair` on the factory contract) that must be signed by a
   * wallet. Always throws {@link EndpointNotAvailableError}.
   */
  async createPair(
    _tokenA: string,
    _tokenB: string,
    _gasLimit?: string,
  ): Promise<TransactionResult & { pairAddress: string }> {
    throw new EndpointNotAvailableError(
      'factory.createPair',
      'creating a pair is an on-chain transaction (create_pair on the factory contract) that must be signed by a wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Get factory statistics
   * @returns Factory-wide statistics
   * @deprecated spot-api does not expose `/factory/*` endpoints (this call
   * always returned HTTP 404). Factory statistics are an on-chain
   * contract read. Always throws {@link EndpointNotAvailableError}.
   */
  async getStats(): Promise<FactoryStats> {
    throw new EndpointNotAvailableError(
      'factory.getStats',
      'factory statistics are an on-chain contract read (all_pairs_length etc.). Query the factory contract via @polkadot/api-contract.',
    );
  }

  /**
   * Check if a pair exists
   * @param _tokenA - First token address
   * @param _tokenB - Second token address
   * @returns Boolean indicating if pair exists
   * @deprecated Depends on `/factory/*` endpoints that spot-api never
   * exposed. Pair existence is an on-chain factory-contract read. Always
   * throws {@link EndpointNotAvailableError}.
   */
  async pairExists(_tokenA: string, _tokenB: string): Promise<boolean> {
    throw new EndpointNotAvailableError(
      'factory.pairExists',
      'pair existence is an on-chain factory-contract read (get_pair). Query the factory contract via @polkadot/api-contract.',
    );
  }
}
