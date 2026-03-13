"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.redisHealthy = redisHealthy;
exports.disconnectRedis = disconnectRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config");
const logger_1 = require("./logger");
let redisClient = null;
function getRedis() {
    if (!redisClient) {
        redisClient = new ioredis_1.default(config_1.config.redis.url, {
            maxRetriesPerRequest: 3,
            enableOfflineQueue: false,
            lazyConnect: false,
            retryStrategy: (times) => Math.min(times * 200, 3000),
        });
        redisClient.on('error', (err) => {
            logger_1.log.error({ err }, '[Redis] Connection error');
        });
    }
    return redisClient;
}
async function redisHealthy() {
    try {
        const client = getRedis();
        // Wait until ready if still connecting; give up after 1 second
        if (client.status !== 'ready') {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 1000);
                client.once('ready', () => { clearTimeout(timer); resolve(); });
                client.once('error', () => { clearTimeout(timer); resolve(); });
            });
        }
        if (client.status !== 'ready')
            return false;
        const pong = await client.ping();
        return pong === 'PONG';
    }
    catch {
        return false;
    }
}
async function disconnectRedis() {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}
//# sourceMappingURL=redis.js.map