import Redis from 'ioredis';
export declare function getRedis(): Redis;
export declare function redisHealthy(): Promise<boolean>;
export declare function disconnectRedis(): Promise<void>;
//# sourceMappingURL=redis.d.ts.map