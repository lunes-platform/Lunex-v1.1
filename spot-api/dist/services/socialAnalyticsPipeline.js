"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialAnalyticsPipeline = void 0;
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const socialAnalyticsService_1 = require("./socialAnalyticsService");
const socialIndexerService_1 = require("./socialIndexerService");
class SocialAnalyticsPipeline {
    constructor() {
        this.timer = null;
        this.running = false;
    }
    isEnabled() {
        return config_1.config.socialAnalytics.enabled;
    }
    async runOnce() {
        if (!this.isEnabled() || this.running) {
            return null;
        }
        this.running = true;
        try {
            const indexerResult = await socialIndexerService_1.socialIndexerService.syncOnce();
            const analyticsResult = await socialAnalyticsService_1.socialAnalyticsService.recomputeLeaderSnapshots();
            return { indexerResult, analyticsResult };
        }
        catch (error) {
            logger_1.log.error({ err: error }, '[SocialAnalyticsPipeline] Run failed');
            return null;
        }
        finally {
            this.running = false;
        }
    }
    async start() {
        if (!this.isEnabled() || this.timer) {
            return;
        }
        await this.runOnce();
        this.timer = setInterval(() => {
            void this.runOnce();
        }, config_1.config.socialAnalytics.pollIntervalMs);
        logger_1.log.info('[SocialAnalyticsPipeline] Started');
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
exports.socialAnalyticsPipeline = new SocialAnalyticsPipeline();
//# sourceMappingURL=socialAnalyticsPipeline.js.map