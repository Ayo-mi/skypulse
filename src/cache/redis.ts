import Redis from 'ioredis';
import { logger } from '../utils/logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('REDIS_URL environment variable is not set');
    }
    client = new Redis(url, {
      lazyConnect: true,
      retryStrategy(times) {
        if (times >= 10) return null;
        return Math.min(times * 200, 3000);
      },
      maxRetriesPerRequest: 3,
    });

    client.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });
    client.on('connect', () => logger.info('Redis connected'));
    client.on('reconnecting', () => logger.warn('Redis reconnecting'));
  }
  return client;
}

/**
 * Get a cached value or call fetchFn to compute and store it.
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    logger.warn('Redis get failed, falling back to fetch', { key, error: String(err) });
  }

  const value = await fetchFn();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn('Redis set failed', { key, error: String(err) });
  }

  return value;
}

/**
 * Build a deterministic cache key from a tool name and parameters object.
 */
export function buildCacheKey(toolName: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k] ?? '')}`)
    .join('&');
  return `skypulse:${toolName}:${sorted}`;
}

/**
 * Invalidate all cache keys matching a pattern (e.g. after ingestion).
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  const redis = getRedis();
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`Invalidated ${keys.length} cache keys`, { pattern });
    }
  } catch (err) {
    logger.warn('Redis invalidation failed', { pattern, error: String(err) });
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
}
