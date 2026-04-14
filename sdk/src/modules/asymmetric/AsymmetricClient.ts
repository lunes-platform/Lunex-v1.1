import { HttpClient } from '../../http-client';
import {
  AsymmetricStrategyConfig,
  StrategyStatus,
  UpdateCurveInput,
} from './types';
import {
  buildWalletActionSignMessage,
  createWalletActionMetadata,
} from '../../spot-utils';

type SignedWalletAuth = {
  nonce?: string;
  timestamp?: number;
  signature?: string;
  signMessage?: (message: string) => Promise<string>;
};

/**
 * AsymmetricClient — SDK module for Lunex V2 Asymmetric Liquidity.
 *
 * Encapsulates parametric curve creation, management, and AI-delegation flows.
 * All methods communicate exclusively with the spot-api /api/v1/asymmetric endpoints.
 *
 * @example
 * ```typescript
 * const sdk = new LunexSDK({ baseURL: 'https://api.lunex.io/v1' });
 *
 * // Create a "Buy the Dip" strategy
 * await sdk.asymmetric.createStrategy({
 *   pairAddress: '5F3sa2...',
 *   isAutoRebalance: true,
 *   profitTargetBps: 500,
 *   buyCurve: { k: '1000000000', leverageL: '0', allocationC: 1,
 *               maxCapacityX0: '5000000000', gamma: 3, feeTargetBps: 30 },
 *   sellCurve: { k: '0', leverageL: '0', allocationC: 1,
 *                maxCapacityX0: '5000000000', gamma: 2, feeTargetBps: 30 },
 * }, userAddress);
 * ```
 */
export class AsymmetricModule {
  constructor(private http: HttpClient) {}

  private normalizeStrategyStatus(status: StrategyStatus): StrategyStatus {
    return {
      ...status,
      isActive: status.isActive ?? status.status === 'ACTIVE',
      healthState: status.healthState ?? status.status,
    };
  }

  private async resolveSignedWalletAction(input: {
    action: string;
    address: string;
    fields?: Record<
      string,
      string | number | boolean | Array<string | number> | undefined | null
    >;
    auth?: SignedWalletAuth;
  }): Promise<{ nonce: string; timestamp: number; signature: string }> {
    const metadata = createWalletActionMetadata();
    const nonce = input.auth?.nonce ?? metadata.nonce;
    const timestamp = input.auth?.timestamp ?? metadata.timestamp;

    if (input.auth?.signature) {
      if (!input.auth.nonce || !input.auth.timestamp) {
        throw new Error(
          'signed action requires nonce and timestamp when signature is provided',
        );
      }
      return { nonce, timestamp, signature: input.auth.signature };
    }

    if (!input.auth?.signMessage) {
      throw new Error(
        'signed action requires auth.signMessage or explicit nonce/timestamp/signature',
      );
    }

    const message = buildWalletActionSignMessage({
      action: input.action,
      address: input.address,
      nonce,
      timestamp,
      fields: input.fields,
    });
    const signature = await input.auth.signMessage(message);
    return { nonce, timestamp, signature };
  }

  /**
   * List all asymmetric strategies owned by a wallet address.
   */
  async listStrategies(
    userAddress: string,
    auth?: SignedWalletAuth,
  ): Promise<StrategyStatus[]> {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategies.list',
      address: userAddress,
      auth,
    });

    const response = await this.http.get<StrategyStatus[]>(
      '/api/v1/asymmetric/strategies',
      {
        address: userAddress,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return response.map((entry) => this.normalizeStrategyStatus(entry));
  }

  /**
   * Create a new parametric liquidity strategy.
   * The on-chain deposit (`deployAsymmetricLiquidity`) must happen separately via wallet.
   * This call registers the strategy in the backend Sentinel.
   */
  async createStrategy(
    config: AsymmetricStrategyConfig,
    userAddress: string,
    auth?: SignedWalletAuth,
  ): Promise<StrategyStatus> {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategy.create',
      address: userAddress,
      fields: {
        pairAddress: config.pairAddress,
        isAutoRebalance: config.isAutoRebalance,
        buyK: config.buyCurve.k,
        buyGamma: config.buyCurve.gamma,
        buyMaxCapacity: config.buyCurve.maxCapacityX0,
        buyFeeTargetBps: config.buyCurve.feeTargetBps,
        sellGamma: config.sellCurve.gamma,
        sellMaxCapacity: config.sellCurve.maxCapacityX0,
        sellFeeTargetBps: config.sellCurve.feeTargetBps,
        sellProfitTargetBps: config.profitTargetBps,
        leverageL: config.buyCurve.leverageL,
        allocationC: config.buyCurve.allocationC,
      },
      auth,
    });

    const response = await this.http.post<StrategyStatus>(
      '/api/v1/asymmetric/strategies',
      {
        userAddress,
        pairAddress: config.pairAddress,
        isAutoRebalance: config.isAutoRebalance,
        buyK: config.buyCurve.k,
        buyGamma: config.buyCurve.gamma,
        buyMaxCapacity: config.buyCurve.maxCapacityX0,
        buyFeeTargetBps: config.buyCurve.feeTargetBps,
        sellGamma: config.sellCurve.gamma,
        sellMaxCapacity: config.sellCurve.maxCapacityX0,
        sellFeeTargetBps: config.sellCurve.feeTargetBps,
        sellProfitTargetBps: config.profitTargetBps,
        leverageL: config.buyCurve.leverageL,
        allocationC: config.buyCurve.allocationC,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return this.normalizeStrategyStatus(response);
  }

  /**
   * Get detailed status and health of a specific strategy.
   */
  async getStrategyStatus(
    strategyId: string,
    userAddress: string,
    auth?: SignedWalletAuth,
  ): Promise<StrategyStatus> {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategy.read',
      address: userAddress,
      fields: { strategyId },
      auth,
    });

    const response = await this.http.get<StrategyStatus>(
      `/api/v1/asymmetric/strategies/${strategyId}`,
      {
        userAddress,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return this.normalizeStrategyStatus(response);
  }

  /**
   * Toggle the backend Sentinel auto-rebalancer on or off.
   * No on-chain transaction needed — pure backend configuration.
   */
  async toggleAutoRebalance(
    strategyId: string,
    userAddress: string,
    enable: boolean,
    auth?: SignedWalletAuth,
  ): Promise<StrategyStatus> {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategy.toggle-auto',
      address: userAddress,
      fields: { strategyId, enable },
      auth,
    });

    const response = await this.http.patch<StrategyStatus>(
      `/api/v1/asymmetric/strategies/${strategyId}/auto`,
      {
        userAddress,
        enable,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return this.normalizeStrategyStatus(response);
  }

  /**
   * Update the mathematical parameters of a curve (buy or sell).
   * This is the primary tool for AI agents with MANAGE_ASYMMETRIC permission.
   * Cannot move funds — only reshapes the curve.
   */
  async updateCurve(
    input: UpdateCurveInput,
    userAddress: string,
    auth?: SignedWalletAuth,
  ): Promise<StrategyStatus> {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategy.update-curve',
      address: userAddress,
      fields: {
        strategyId: input.strategyId,
        isBuySide: input.isBuySide,
        newGamma: input.newGamma,
        newMaxCapacity: input.newMaxCapacityX0,
        newFeeTargetBps: input.newFeeTargetBps,
      },
      auth,
    });

    const response = await this.http.patch<StrategyStatus>(
      `/api/v1/asymmetric/strategies/${input.strategyId}/curve`,
      {
        userAddress,
        isBuySide: input.isBuySide,
        newGamma: input.newGamma,
        newMaxCapacity: input.newMaxCapacityX0,
        newFeeTargetBps: input.newFeeTargetBps,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
    return this.normalizeStrategyStatus(response);
  }

  /**
   * Fetch rebalance execution logs for a strategy.
   */
  async getRebalanceLogs(
    strategyId: string,
    userAddress: string,
    limit = 50,
    auth?: SignedWalletAuth,
  ) {
    const signed = await this.resolveSignedWalletAction({
      action: 'asymmetric.strategy.logs',
      address: userAddress,
      fields: { strategyId, limit },
      auth,
    });

    return this.http.get<any[]>(
      `/api/v1/asymmetric/strategies/${strategyId}/logs`,
      {
        userAddress,
        limit,
        nonce: signed.nonce,
        timestamp: signed.timestamp,
        signature: signed.signature,
      },
    );
  }

  // ─── Curve math helpers ────────────────────────────────────────

  /**
   * Simulate the parametric curve output for given parameters.
   * Useful for building the CurveChart visualization.
   *
   * Formula: y = (k + c·L) · (1 - x/x₀')^γ - t·x - r·L
   *
   * @returns Available liquidity at volume point x
   */
  simulateLiquidity(params: {
    x: number; // volume point (USDC units)
    k: number; // base liquidity
    L: number; // leverage amount
    c: number; // allocation fraction 0–1
    x0: number; // max capacity
    gamma: number; // curvature 1–5
    feeT: number; // fee rate 0–1 (e.g. 0.003)
    interestR: number; // interest rate (e.g. 0.01)
  }): number {
    const { x, k, L, c, x0, gamma, feeT, interestR } = params;
    if (x >= x0) return 0;
    const base = k + c * L;
    const exhaustion = Math.pow(1 - x / x0, gamma);
    const gross = base * exhaustion;
    const feeDiscount = feeT * x;
    const interestDiscount = interestR * L;
    return Math.max(0, gross - feeDiscount - interestDiscount);
  }
}
