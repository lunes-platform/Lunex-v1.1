import { HttpClient } from '../http-client';
import {
  StakePosition,
  Proposal,
  PaginationParams,
  Pagination,
  TransactionResult,
  StakingStats,
} from '../types';
import { EndpointNotAvailableError } from '../errors';

export class StakingModule {
  constructor(private http: HttpClient) {}

  /**
   * Stake LUNES tokens
   * @param _amount - Amount to stake
   * @param _duration - Staking duration in seconds
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with tier and rewards info
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Staking is an on-chain transaction on the
   * staking contract that must be signed by the user's wallet. Always
   * throws {@link EndpointNotAvailableError}.
   */
  async stake(
    _amount: string,
    _duration: number,
    _gasLimit?: string,
  ): Promise<
    TransactionResult & {
      tier: string;
      estimatedRewards: string;
      apr: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.stake',
      'staking is an on-chain transaction on the staking contract that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Unstake tokens
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with amount and rewards
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Unstaking is an on-chain transaction on
   * the staking contract. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async unstake(_gasLimit?: string): Promise<
    TransactionResult & {
      amount: string;
      rewards: string;
      penalty: string;
      totalReceived: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.unstake',
      'unstaking is an on-chain transaction on the staking contract that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Claim staking rewards
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with rewards amount
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Claiming staking rewards is an on-chain
   * transaction on the staking contract. For off-chain trading rewards
   * use `sdk.rewards` (GET/POST /api/v1/rewards/*). Always throws
   * {@link EndpointNotAvailableError}.
   */
  async claimRewards(_gasLimit?: string): Promise<
    TransactionResult & {
      rewards: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.claimRewards',
      'claiming staking rewards is an on-chain transaction on the staking contract. For off-chain trading rewards use sdk.rewards (/api/v1/rewards/*).',
    );
  }

  /**
   * Get staking position for an address
   * @param _address - Staker address
   * @returns Current staking position
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Staking positions are on-chain contract
   * reads. Always throws {@link EndpointNotAvailableError}.
   */
  async getPosition(_address: string): Promise<StakePosition> {
    throw new EndpointNotAvailableError(
      'staking.getPosition',
      'staking positions are on-chain reads on the staking contract. Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Get staking statistics
   * @returns Global staking statistics
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Staking statistics are on-chain contract
   * reads. Always throws {@link EndpointNotAvailableError}.
   */
  async getStats(): Promise<StakingStats> {
    throw new EndpointNotAvailableError(
      'staking.getStats',
      'staking statistics are on-chain reads on the staking contract. Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Create a governance proposal
   * @param _params - Proposal parameters
   * @returns Transaction result with proposal ID
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Creating proposals is an on-chain
   * governance transaction. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async createProposal(_params: {
    name: string;
    description: string;
    tokenAddress: string;
    fee: string;
    gasLimit?: string;
  }): Promise<
    TransactionResult & {
      proposalId: number;
      votingDeadline: number;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.createProposal',
      'creating proposals is an on-chain governance transaction that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Vote on a proposal
   * @param _proposalId - Proposal ID
   * @param _inFavor - Vote in favor (true) or against (false)
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with vote power
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Voting is an on-chain governance
   * transaction. The REST surface only offers vote *tracking* at
   * `POST /api/v1/governance/vote/check|record` and
   * `GET /api/v1/governance/vote/history`, which require an
   * sr25519-signed payload incompatible with this signature. Always
   * throws {@link EndpointNotAvailableError}.
   */
  async vote(
    _proposalId: number,
    _inFavor: boolean,
    _gasLimit?: string,
  ): Promise<
    TransactionResult & {
      votePower: string;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.vote',
      'voting is an on-chain governance transaction signed by the wallet. REST only tracks votes (POST /api/v1/governance/vote/record, sr25519-signed payload).',
    );
  }

  /**
   * Execute a proposal after voting period
   * @param _proposalId - Proposal ID
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result with execution status
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Executing proposals is an on-chain
   * governance transaction. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async executeProposal(
    _proposalId: number,
    _gasLimit?: string,
  ): Promise<
    TransactionResult & {
      approved: boolean;
      votesFor: string;
      votesAgainst: string;
      executed: boolean;
    }
  > {
    throw new EndpointNotAvailableError(
      'staking.executeProposal',
      'executing proposals is an on-chain governance transaction that must be signed by the wallet via @polkadot/api-contract.',
    );
  }

  /**
   * Get all proposals
   * @param _params - Filter and pagination parameters
   * @returns List of proposals
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Proposals live on-chain (governance
   * contract). Always throws {@link EndpointNotAvailableError}.
   */
  async getAllProposals(
    _params?: {
      status?: 'active' | 'executed' | 'all';
    } & PaginationParams,
  ): Promise<{
    proposals: Proposal[];
    pagination: Pagination;
  }> {
    throw new EndpointNotAvailableError(
      'staking.getAllProposals',
      'proposals live on-chain (governance/staking contract). Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Get a specific proposal
   * @param _id - Proposal ID
   * @returns Proposal details
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Proposals live on-chain (governance
   * contract). Always throws {@link EndpointNotAvailableError}.
   */
  async getProposal(_id: number): Promise<Proposal> {
    throw new EndpointNotAvailableError(
      'staking.getProposal',
      'proposals live on-chain (governance/staking contract). Query the contract via @polkadot/api-contract.',
    );
  }

  /**
   * Check if a token is approved for listing
   * @param _tokenAddress - Token address
   * @returns Approval status
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Listing approval lives on-chain
   * (listing_manager contract); the REST listing flow is exposed at
   * `/api/v1/listing/*`. Always throws
   * {@link EndpointNotAvailableError}.
   */
  async isTokenApproved(_tokenAddress: string): Promise<{
    approved: boolean;
    approvedAt?: string;
    method?: string;
  }> {
    throw new EndpointNotAvailableError(
      'staking.isTokenApproved',
      'listing approval lives on-chain (listing_manager contract); the REST listing flow is exposed under /api/v1/listing/*.',
    );
  }

  /**
   * Admin: List a token directly
   * @param _tokenAddress - Token address
   * @param _reason - Listing reason
   * @param _gasLimit - Optional gas limit
   * @returns Transaction result
   * @deprecated spot-api does not expose `/staking/*` endpoints (this call
   * always returned HTTP 404). Direct token listing is an on-chain admin
   * transaction; the REST listing flow is exposed at `/api/v1/listing/*`
   * and admin token registration at `POST /api/v1/tokens` (admin
   * bearer). Always throws {@link EndpointNotAvailableError}.
   */
  async adminListToken(
    _tokenAddress: string,
    _reason: string,
    _gasLimit?: string,
  ): Promise<TransactionResult> {
    throw new EndpointNotAvailableError(
      'staking.adminListToken',
      'direct token listing is an on-chain admin transaction. Use the REST listing flow (/api/v1/listing/*) or POST /api/v1/tokens (admin) for registry entries.',
    );
  }
}
