import { Decimal } from '@prisma/client/runtime/library';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ApiPromise, Keyring, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import prisma from '../db';
import { config } from '../config';
import { log } from '../utils/logger';
import {
  asymmetricService,
  isCoolingDown,
  isProfitableToRebalance,
} from './asymmetricService';

// ─── Constants ──────────────────────────────────────────────────

const EXPONENTIAL_BACKOFF_BASE_MS = 10_000; // 10s → 20s → 40s
const ASYMMETRIC_PAIR_ABI_PATH = path.resolve(
  __dirname,
  '../../../lunes-dex-main/src/abis/AsymmetricPair.json',
);
const ACCOUNT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const PLANCKS_PER_UNIT = new Decimal('1000000000000');

function unitsToPlancks(value: string | number) {
  return BigInt(new Decimal(value).mul(PLANCKS_PER_UNIT).toFixed(0));
}

function plancksToUnits(value: string | number | bigint) {
  return new Decimal(value.toString()).div(PLANCKS_PER_UNIT).toNumber();
}

// ─── Rebalancer Service ─────────────────────────────────────────

class RebalancerService {
  private api: ApiPromise | null = null;
  private relayer: ReturnType<Keyring['addFromUri']> | null = null;
  private initPromise: Promise<boolean> | null = null;
  private asymmetricPairAbi: any = null;

  private isConfigured() {
    return Boolean(config.blockchain.wsUrl && config.blockchain.relayerSeed);
  }

  isEnabled() {
    return this.isConfigured();
  }

  async ensureReady() {
    if (!this.isConfigured()) return false;
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize() {
    try {
      await cryptoWaitReady();
      const provider = new WsProvider(config.blockchain.wsUrl);
      this.api = await ApiPromise.create({ provider });
      await this.api.isReady;

      const keyring = new Keyring({ type: 'sr25519' });
      this.relayer = keyring.addFromUri(config.blockchain.relayerSeed);

      // Load ABI if available (graceful — contract may not be deployed yet)
      try {
        const raw = await fs.readFile(ASYMMETRIC_PAIR_ABI_PATH, 'utf-8');
        this.asymmetricPairAbi = JSON.parse(raw);
      } catch {
        log.warn(
          '[Rebalancer] AsymmetricPair ABI not found — on-chain updates disabled',
        );
      }

      log.info('[Rebalancer] Sentinel ready');
      return true;
    } catch (error) {
      log.error({ err: error }, '[Rebalancer] Failed to initialize');
      return false;
    }
  }

  // ─── Main entry point called by socialIndexerService ──────────

  /**
   * Triggered when the on-chain indexer detects an AsymmetricSwapExecuted event.
   * Runs the full Sentinel safety pipeline before calling the Relayer.
   */
  async handleCurveExecution(
    pairAddress: string,
    userAddress: string,
    acquiredAmount: number,
  ) {
    let strategy = await prisma.asymmetricStrategy.findFirst({
      where: {
        pairAddress,
        userAddress,
        isAutoRebalance: true,
        status: { in: ['ACTIVE', 'COOLING_DOWN'] },
      },
    });

    if (!strategy) {
      log.warn(
        { pairAddress, userAddress },
        '[Rebalancer] No user-bound asymmetric strategy found for execution event',
      );
      return;
    }

    if (strategy.agentId) return; // AI agent managing this — backend stays out

    await this.safeRebalance(strategy, acquiredAmount);
  }

  async getRelayerAddress() {
    if (this.relayer) {
      return this.relayer.address;
    }

    if (!config.blockchain.relayerSeed) {
      return null;
    }

    await cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519' });
    return keyring.addFromUri(config.blockchain.relayerSeed).address;
  }

  async getManager(contractAddress: string) {
    const isReady = await this.ensureReady();
    const caller = await this.getRelayerAddress();
    if (!isReady || !caller || !this.api || !this.asymmetricPairAbi) {
      return null;
    }

    const contract = new ContractPromise(
      this.api as any,
      this.asymmetricPairAbi,
      contractAddress,
    );
    const { output } = await contract.query.getManager(caller, {
      gasLimit: -1,
      storageDepositLimit: null,
    });

    const json = output?.toJSON?.() as any;
    const normalized =
      typeof json === 'string'
        ? json
        : (json?.some ?? output?.toString?.()?.trim());

    if (!normalized || normalized === 'None' || normalized === 'null') {
      return null;
    }

    return String(normalized);
  }

  async isManagedByRelayer(contractAddress: string) {
    const [managerAddress, relayerAddress] = await Promise.all([
      this.getManager(contractAddress),
      this.getRelayerAddress(),
    ]);

    return Boolean(
      managerAddress && relayerAddress && managerAddress === relayerAddress,
    );
  }

  async getCurveState(contractAddress: string, isBuySide: boolean) {
    const isReady = await this.ensureReady();
    const caller = await this.getRelayerAddress();
    if (!isReady || !caller || !this.api || !this.asymmetricPairAbi) {
      return null;
    }

    const contract = new ContractPromise(
      this.api as any,
      this.asymmetricPairAbi,
      contractAddress,
    );
    const { output, result } = isBuySide
      ? await contract.query.getBuyCurve(caller, {
          gasLimit: -1,
          storageDepositLimit: null,
        })
      : await contract.query.getSellCurve(caller, {
          gasLimit: -1,
          storageDepositLimit: null,
        });

    if (result.isErr || !output) {
      return null;
    }

    const json = output.toJSON() as any;
    const curve = json?.ok ?? json;

    return {
      k: plancksToUnits(curve?.k ?? 0),
      gamma: Number(curve?.gamma ?? 0),
      maxCapacity: plancksToUnits(
        curve?.maxCapacityX0 ?? curve?.max_capacity_x0 ?? 0,
      ),
      feeBps: Number(curve?.feeBps ?? curve?.fee_bps ?? 0),
      currentVolume: plancksToUnits(
        curve?.currentVolume ?? curve?.current_volume ?? 0,
      ),
    };
  }

  // ─── Sentinel safety pipeline ──────────────────────────────────

  private async safeRebalance(strategy: any, acquiredAmount: number) {
    // 1. Cooldown — accumulate, don't send
    if (isCoolingDown(strategy.lastRebalancedAt)) {
      await asymmetricService.accumulatePending(strategy.id, acquiredAmount);
      return;
    }

    // 2. Profitability — avoid burning gas on dust
    const pendingTotal =
      parseFloat(strategy.pendingAmount.toString()) + acquiredAmount;
    if (!isProfitableToRebalance(pendingTotal)) {
      await asymmetricService.accumulatePending(strategy.id, acquiredAmount);
      return;
    }

    // 3. Health check — reuse the existing /health endpoint data
    try {
      const health = await this.getSystemHealth(strategy.pairAddress);
      if (health.spread > 1000 || health.oracleAge > 120) {
        log.warn(
          { pairAddress: strategy.pairAddress },
          '[Sentinel] High volatility. Rebalance deferred',
        );
        return;
      }
    } catch {
      log.warn('[Sentinel] Health check unavailable. Rebalance deferred');
      return;
    }

    // 4. Execute with exponential backoff retry
    await this.executeWithRetry(strategy, pendingTotal);
  }

  private async executeWithRetry(strategy: any, totalAmount: number) {
    const isReady = await this.ensureReady();
    if (!isReady || !this.relayer || !this.api || !this.asymmetricPairAbi) {
      log.warn('[Sentinel] Not ready for on-chain execution — skipping');
      return;
    }

    for (let attempt = 0; attempt < asymmetricService.MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = EXPONENTIAL_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
        }

        const txHash = await this.sendUpdateCurveTx(strategy, {
          isBuySide: false,
          newMaxCapacity: totalAmount,
        });
        await asymmetricService.markRebalancedSuccess(strategy.id);

        // Log success
        await prisma.asymmetricRebalanceLog.create({
          data: {
            strategyId: strategy.id,
            side: 'SELL', // After buy accumulation, we update the sell curve
            trigger: 'AUTO_REBALANCER',
            acquiredAmount: new Decimal(totalAmount),
            newCapacity: new Decimal(totalAmount),
            txHash,
            status: 'SUCCESS',
          },
        });

        log.info(
          { userAddress: strategy.userAddress, txHash },
          '[Sentinel] Rebalanced successfully',
        );
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(
          { attempt: attempt + 1, errorMsg },
          '[Sentinel] Rebalance attempt failed',
        );

        const suspended = await asymmetricService.recordFailure(
          strategy.id,
          errorMsg,
        );

        await prisma.asymmetricRebalanceLog.create({
          data: {
            strategyId: strategy.id,
            side: 'SELL',
            trigger: 'AUTO_REBALANCER',
            acquiredAmount: new Decimal(totalAmount),
            newCapacity: new Decimal(0),
            status: 'FAILED',
          },
        });

        if (suspended) {
          log.error(
            {
              strategyId: strategy.id,
              maxRetries: asymmetricService.MAX_RETRIES,
            },
            '[Sentinel] Strategy SUSPENDED_ERROR after max failures',
          );
          return;
        }
      }
    }
  }

  async executeAgentCurveUpdate(
    strategyId: string,
    input: {
      isBuySide: boolean;
      newGamma?: number;
      newMaxCapacity?: string;
      newFeeTargetBps?: number;
    },
  ) {
    const strategy = await prisma.asymmetricStrategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) throw new Error('Strategy not found');

    if (!(await this.isManagedByRelayer(strategy.pairAddress))) {
      throw new Error(
        'Relayer is not delegated as manager on this AsymmetricPair',
      );
    }

    const txHash = await this.sendUpdateCurveTx(strategy, input);
    const updated = await asymmetricService.applyCurveParams(strategyId, input);

    await prisma.asymmetricRebalanceLog.create({
      data: {
        strategyId,
        side: input.isBuySide ? 'BUY' : 'SELL',
        trigger: 'AI_AGENT',
        acquiredAmount: new Decimal(0),
        newCapacity: new Decimal(
          input.newMaxCapacity ??
            (input.isBuySide
              ? strategy.buyMaxCapacity.toString()
              : strategy.sellMaxCapacity.toString()),
        ),
        txHash,
        status: 'SUCCESS',
      },
    });

    return { strategy: updated, txHash };
  }

  private async sendUpdateCurveTx(
    _strategy: any,
    input: {
      isBuySide: boolean;
      newGamma?: number;
      newMaxCapacity?: string | number;
      newFeeTargetBps?: number;
    },
  ): Promise<string> {
    if (!this.api || !this.relayer || !this.asymmetricPairAbi) {
      throw new Error('Rebalancer not initialized');
    }

    const contract = new ContractPromise(
      this.api as any,
      this.asymmetricPairAbi,
      _strategy.pairAddress,
    );

    const nextCapacity =
      input.newMaxCapacity !== undefined
        ? unitsToPlancks(input.newMaxCapacity)
        : null;

    // Dry-run to estimate gas (same pattern as settlementService.ts)
    const { gasRequired, result } = await contract.query.updateCurveParameters(
      this.relayer.address,
      { gasLimit: -1, storageDepositLimit: null },
      input.isBuySide,
      input.newGamma ?? null,
      nextCapacity,
      input.newFeeTargetBps ?? null,
    );

    if (result.isErr) {
      throw new Error(`[Rebalancer] Gas dry-run failed: ${result.toString()}`);
    }

    return new Promise<string>((resolve, reject) => {
      let unsub: (() => void) | undefined;

      contract.tx
        .updateCurveParameters(
          { gasLimit: gasRequired, storageDepositLimit: null },
          input.isBuySide,
          input.newGamma ?? null,
          nextCapacity,
          input.newFeeTargetBps ?? null,
        )
        .signAndSend(this.relayer!, (txResult: any) => {
          if (txResult.dispatchError) {
            if (unsub) unsub();
            reject(new Error(txResult.dispatchError.toString()));
            return;
          }
          if (txResult.status.isInBlock || txResult.status.isFinalized) {
            const txHash = txResult.txHash.toHex();
            if (unsub) unsub();
            resolve(txHash);
          }
        })
        .then((unsubscribe: () => void) => {
          unsub = unsubscribe;
        })
        .catch(reject);
    });
  }

  // ─── Health check (reuses existing /health logic) ──────────────

  private async getSystemHealth(pairAddress: string) {
    if (!ACCOUNT_REGEX.test(pairAddress)) {
      return { spread: 0, oracleAge: 0 };
    }

    // Try to derive spread from the orderbook if we can resolve a pair symbol
    const pair = await (prisma as any).pair.findFirst({
      where: { pairAddress },
      select: { symbol: true },
    });

    let spread = 0;
    let oracleAge = 0;

    if (pair?.symbol) {
      // 1. Orderbook spread
      const { orderbookManager } = await import('../utils/orderbook');
      const book = orderbookManager.get(pair.symbol);
      if (book) {
        const bestBid = book.getBestBid();
        const bestAsk = book.getBestAsk();
        const lastUpdated = book.getLastUpdatedAt();

        if (bestBid !== null && bestAsk !== null && bestBid > 0) {
          const mid = (bestBid + bestAsk) / 2;
          spread = Math.round(((bestAsk - bestBid) / mid) * 10_000); // BPS
        }

        if (lastUpdated !== null) {
          oracleAge = Math.floor((Date.now() - lastUpdated) / 1000); // seconds
        }
      }

      // 2. Margin price health monitor (check if pair is operationally blocked)
      const { marginService } = await import('./marginService');
      const health = marginService.getPriceHealth(pair.symbol);
      if (health.pairs.length > 0) {
        const pairHealth = health.pairs[0];
        if (pairHealth.isOperationallyBlocked) {
          spread = 10_000; // Force-defer: treat blocked pair as extreme spread
        }
      }
    }

    return { spread, oracleAge };
  }
}

// ─── Utility ────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const rebalancerService = new RebalancerService();
