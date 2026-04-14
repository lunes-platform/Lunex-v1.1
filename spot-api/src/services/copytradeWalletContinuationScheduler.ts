import { config } from '../config';
import { log } from '../utils/logger';
import { copytradeWalletContinuationsPending } from '../utils/metrics';
import { copytradeService } from './copytradeService';

let intervalId: ReturnType<typeof setInterval> | null = null;

export const copytradeWalletContinuationScheduler = {
  start() {
    if (!config.copytrade.walletContinuationSchedulerEnabled) {
      log.info('[CopytradeWalletContinuationScheduler] Disabled by config');
      return;
    }

    log.info(
      `[CopytradeWalletContinuationScheduler] Starting — sweep every ${config.copytrade.walletContinuationSweepIntervalMs}ms`,
    );

    intervalId = setInterval(() => {
      this.runSweep();
    }, config.copytrade.walletContinuationSweepIntervalMs);

    this.runSweep();
  },

  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      log.info('[CopytradeWalletContinuationScheduler] Stopped');
    }
  },

  async runSweep() {
    try {
      const result = await copytradeService.expirePendingWalletContinuations();
      copytradeWalletContinuationsPending.set(result.pendingAfter);

      if (!result.available) return;

      if (result.expiredCount > 0) {
        log.info(
          {
            expiredCount: result.expiredCount,
            pendingAfter: result.pendingAfter,
            cutoff: result.cutoff?.toISOString?.() ?? null,
          },
          '[CopytradeWalletContinuationScheduler] Expired stale wallet-assisted continuations',
        );
      }
    } catch (err) {
      log.error({ err }, '[CopytradeWalletContinuationScheduler] Sweep failed');
    }
  },
};
