"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
exports.log = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || 'info',
    transport: config_1.config.isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    base: {
        service: 'lunex-spot-api',
        env: config_1.config.nodeEnv,
    },
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
    redact: {
        paths: ['*.password', '*.relayerSeed', '*.apiKeyHash', '*.signature'],
        censor: '[REDACTED]',
    },
});
//# sourceMappingURL=logger.js.map