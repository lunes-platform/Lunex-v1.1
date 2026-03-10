import { config } from '../config'
import { log } from '../utils/logger'
import { socialAnalyticsService } from './socialAnalyticsService'
import { socialIndexerService } from './socialIndexerService'

class SocialAnalyticsPipeline {
  private timer: NodeJS.Timeout | null = null
  private running = false

  isEnabled() {
    return config.socialAnalytics.enabled
  }

  async runOnce() {
    if (!this.isEnabled() || this.running) {
      return null
    }

    this.running = true

    try {
      const indexerResult = await socialIndexerService.syncOnce()
      const analyticsResult = await socialAnalyticsService.recomputeLeaderSnapshots()
      return { indexerResult, analyticsResult }
    } catch (error) {
      log.error({ err: error }, '[SocialAnalyticsPipeline] Run failed')
      return null
    } finally {
      this.running = false
    }
  }

  async start() {
    if (!this.isEnabled() || this.timer) {
      return
    }

    await this.runOnce()

    this.timer = setInterval(() => {
      void this.runOnce()
    }, config.socialAnalytics.pollIntervalMs)

    log.info('[SocialAnalyticsPipeline] Started')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

export const socialAnalyticsPipeline = new SocialAnalyticsPipeline()
