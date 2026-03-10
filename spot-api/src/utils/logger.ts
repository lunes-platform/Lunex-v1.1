import pino from 'pino'
import { config } from '../config'

export const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: config.isProd
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
    env: config.nodeEnv,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['*.password', '*.relayerSeed', '*.apiKeyHash', '*.signature'],
    censor: '[REDACTED]',
  },
})
