"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewardScheduler = void 0;
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const rewardDistributionService_1 = require("./rewardDistributionService");
let intervalId = null;
/**
 * Weekly reward distribution scheduler.
 * Runs every Monday at 00:00 UTC.
 *
 * Uses setInterval with hourly checks instead of node-cron
 * to avoid adding an external dependency.
 */
exports.rewardScheduler = {
    start() {
        if (!config_1.config.rewards.enabled) {
            logger_1.log.info('[RewardScheduler] Disabled by config (REWARDS_ENABLED != true)');
            return;
        }
        logger_1.log.info('[RewardScheduler] Starting — will check hourly for distribution window');
        // Check every hour if it's time to distribute
        intervalId = setInterval(() => {
            this.checkAndDistribute();
        }, 60 * 60 * 1000); // 1 hour
        // Also check immediately on startup
        this.checkAndDistribute();
    },
    stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
            logger_1.log.info('[RewardScheduler] Stopped');
        }
    },
    async checkAndDistribute() {
        try {
            const now = new Date();
            const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
            const hour = now.getUTCHours();
            // Only run on Monday between 00:00-00:59 UTC
            if (dayOfWeek !== 1 || hour !== 0)
                return;
            logger_1.log.info('[RewardScheduler] Monday 00:xx UTC — triggering weekly distribution');
            const result = await rewardDistributionService_1.rewardDistributionService.runWeeklyDistribution();
            if (result) {
                logger_1.log.info({ result }, '[RewardScheduler] Distribution completed');
            }
        }
        catch (err) {
            logger_1.log.error({ err }, '[RewardScheduler] Distribution failed');
        }
    },
    /** Manual trigger for admin/testing. */
    async forceDistribute() {
        logger_1.log.info('[RewardScheduler] Forced distribution triggered');
        return rewardDistributionService_1.rewardDistributionService.runWeeklyDistribution();
    },
};
//# sourceMappingURL=rewardScheduler.js.map