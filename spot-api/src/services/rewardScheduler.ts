import { log } from '../utils/logger'
import { config } from '../config'
import { rewardDistributionService } from './rewardDistributionService'

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Weekly reward distribution scheduler.
 * Runs every Monday at 00:00 UTC.
 *
 * Uses setInterval with hourly checks instead of node-cron
 * to avoid adding an external dependency.
 */
export const rewardScheduler = {

  start() {
    if (!config.rewards.enabled) {
      log.info('[RewardScheduler] Disabled by config (REWARDS_ENABLED != true)')
      return
    }

    log.info('[RewardScheduler] Starting — will check hourly for distribution window')

    // Check every hour if it's time to distribute
    intervalId = setInterval(() => {
      this.checkAndDistribute()
    }, 60 * 60 * 1000) // 1 hour

    // Also check immediately on startup
    this.checkAndDistribute()
  },

  stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
      log.info('[RewardScheduler] Stopped')
    }
  },

  async checkAndDistribute() {
    try {
      const now = new Date()
      const dayOfWeek = now.getUTCDay() // 0=Sun, 1=Mon
      const hour = now.getUTCHours()

      // Only run on Monday between 00:00-00:59 UTC
      if (dayOfWeek !== 1 || hour !== 0) return

      log.info('[RewardScheduler] Monday 00:xx UTC — triggering weekly distribution')

      const result = await rewardDistributionService.runWeeklyDistribution()

      if (result) {
        log.info({ result }, '[RewardScheduler] Distribution completed')
      }
    } catch (err) {
      log.error({ err }, '[RewardScheduler] Distribution failed')
    }
  },

  /** Manual trigger for admin/testing. */
  async forceDistribute() {
    log.info('[RewardScheduler] Forced distribution triggered')
    return rewardDistributionService.runWeeklyDistribution()
  },
}
