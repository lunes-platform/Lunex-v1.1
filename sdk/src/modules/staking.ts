import { HttpClient } from '../http-client';
import {
  StakePosition,
  Proposal,
  PaginationParams,
  Pagination,
  TransactionResult,
  StakingStats,
} from '../types';

export class StakingModule {
  constructor(private http: HttpClient) {}

  /**
   * Stake LUNES tokens
   * @param amount - Amount to stake
   * @param duration - Staking duration in seconds
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with tier and rewards info
   */
  async stake(
    amount: string,
    duration: number,
    gasLimit?: string,
  ): Promise<
    TransactionResult & {
      tier: string;
      estimatedRewards: string;
      apr: string;
    }
  > {
    return this.http.post('/staking/stake', {
      amount,
      duration,
      gasLimit: gasLimit || '300000000000',
    });
  }

  /**
   * Unstake tokens
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with amount and rewards
   */
  async unstake(gasLimit?: string): Promise<
    TransactionResult & {
      amount: string;
      rewards: string;
      penalty: string;
      totalReceived: string;
    }
  > {
    return this.http.post('/staking/unstake', {
      gasLimit: gasLimit || '300000000000',
    });
  }

  /**
   * Claim staking rewards
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with rewards amount
   */
  async claimRewards(gasLimit?: string): Promise<
    TransactionResult & {
      rewards: string;
    }
  > {
    return this.http.post('/staking/claim', {
      gasLimit: gasLimit || '200000000000',
    });
  }

  /**
   * Get staking position for an address
   * @param address - Staker address
   * @returns Current staking position
   */
  async getPosition(address: string): Promise<StakePosition> {
    return this.http.get(`/staking/position/${address}`);
  }

  /**
   * Get staking statistics
   * @returns Global staking statistics
   */
  async getStats(): Promise<StakingStats> {
    return this.http.get('/staking/stats');
  }

  /**
   * Create a governance proposal
   * @param params - Proposal parameters
   * @returns Transaction result with proposal ID
   */
  async createProposal(params: {
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
    return this.http.post('/staking/proposal', {
      ...params,
      gasLimit: params.gasLimit || '400000000000',
    });
  }

  /**
   * Vote on a proposal
   * @param proposalId - Proposal ID
   * @param inFavor - Vote in favor (true) or against (false)
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with vote power
   */
  async vote(
    proposalId: number,
    inFavor: boolean,
    gasLimit?: string,
  ): Promise<
    TransactionResult & {
      votePower: string;
    }
  > {
    return this.http.post('/staking/vote', {
      proposalId,
      inFavor,
      gasLimit: gasLimit || '200000000000',
    });
  }

  /**
   * Execute a proposal after voting period
   * @param proposalId - Proposal ID
   * @param gasLimit - Optional gas limit
   * @returns Transaction result with execution status
   */
  async executeProposal(
    proposalId: number,
    gasLimit?: string,
  ): Promise<
    TransactionResult & {
      approved: boolean;
      votesFor: string;
      votesAgainst: string;
      executed: boolean;
    }
  > {
    return this.http.post(`/staking/proposal/${proposalId}/execute`, {
      gasLimit: gasLimit || '300000000000',
    });
  }

  /**
   * Get all proposals
   * @param params - Filter and pagination parameters
   * @returns List of proposals
   */
  async getAllProposals(
    params?: {
      status?: 'active' | 'executed' | 'all';
    } & PaginationParams,
  ): Promise<{
    proposals: Proposal[];
    pagination: Pagination;
  }> {
    return this.http.get('/staking/proposals', params);
  }

  /**
   * Get a specific proposal
   * @param id - Proposal ID
   * @returns Proposal details
   */
  async getProposal(id: number): Promise<Proposal> {
    return this.http.get(`/staking/proposal/${id}`);
  }

  /**
   * Check if a token is approved for listing
   * @param tokenAddress - Token address
   * @returns Approval status
   */
  async isTokenApproved(tokenAddress: string): Promise<{
    approved: boolean;
    approvedAt?: string;
    method?: string;
  }> {
    return this.http.get(`/staking/token/${tokenAddress}/approved`);
  }

  /**
   * Admin: List a token directly
   * @param tokenAddress - Token address
   * @param reason - Listing reason
   * @param gasLimit - Optional gas limit
   * @returns Transaction result
   */
  async adminListToken(
    tokenAddress: string,
    reason: string,
    gasLimit?: string,
  ): Promise<TransactionResult> {
    return this.http.post('/staking/admin/list-token', {
      tokenAddress,
      reason,
      gasLimit: gasLimit || '200000000000',
    });
  }
}
