import Redis from 'ioredis'
import { config } from '../config'
import { log } from './logger'

let redisClient: Redis | null = null

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    })

    redisClient.on('error', (err) => {
      log.error({ err }, '[Redis] Connection error')
    })
  }

  return redisClient
}

export async function redisHealthy(): Promise<boolean> {
  try {
    const client = getRedis()
    // Wait until ready if still connecting; give up after 1 second
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        client.once('ready', () => { clearTimeout(timer); resolve() })
        client.once('error', () => { clearTimeout(timer); resolve() })
      })
    }
    if (client.status !== 'ready') return false
    const pong = await client.ping()
    return pong === 'PONG'
  } catch {
    return false
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
  }
}
