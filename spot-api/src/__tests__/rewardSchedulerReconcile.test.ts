jest.mock('../services/rewardDistributionService', () => ({
  rewardDistributionService: {
    runWeeklyDistribution: jest.fn(),
    reconcileUnknownPayouts: jest.fn(),
    retryFailedPayouts: jest.fn(),
  },
}));

import { rewardScheduler } from '../services/rewardScheduler';
import { rewardDistributionService } from '../services/rewardDistributionService';

const svc = rewardDistributionService as unknown as {
  reconcileUnknownPayouts: jest.Mock;
  retryFailedPayouts: jest.Mock;
};

describe('rewardScheduler.reconcilePayouts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reconciles UNKNOWN payouts by hash every tick', async () => {
    svc.reconcileUnknownPayouts.mockResolvedValue({
      checked: 1,
      confirmed: 1,
      failed: 0,
      pending: 0,
    });
    await rewardScheduler.reconcilePayouts();
    expect(svc.reconcileUnknownPayouts).toHaveBeenCalledTimes(1);
  });

  it('never auto-retries FAILED payouts (legacy FAILED rows may be paid)', async () => {
    svc.reconcileUnknownPayouts.mockResolvedValue({
      checked: 0,
      confirmed: 0,
      failed: 0,
      pending: 0,
    });
    await rewardScheduler.reconcilePayouts();
    expect(svc.retryFailedPayouts).not.toHaveBeenCalled();
  });

  it('swallows reconcile errors so the scheduler keeps running', async () => {
    svc.reconcileUnknownPayouts.mockRejectedValue(new Error('chain down'));
    await expect(rewardScheduler.reconcilePayouts()).resolves.toBeUndefined();
  });
});
