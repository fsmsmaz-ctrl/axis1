import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      '[DB] DATABASE_URL is not set. ' +
      'Please set it to your Supabase connection pooler URL.'
    )
  }

  return new PrismaClient({
    log: ['error', 'warn'],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db
}

// ────────────────────────────────────────────────────────────────
// Simple in-memory cache with TTL for dashboard/perf aggregations.
// Avoids hammering the DB on every dashboard page load.
// ────────────────────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const memoryCache = new Map<string, CacheEntry<any>>()

/**
 * Get a cached value if still valid, otherwise call `fetcher` and store.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  const hit = memoryCache.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.data as T
  }
  // Compute fresh value (only one in-flight caller per key; concurrent callers
  // will simply await the same promise if we add a pending marker — keeping it
  // simple here, the slight thundering herd is acceptable for a dashboard).
  const data = await fetcher()
  memoryCache.set(key, { data, expiresAt: now + ttlMs })
  return data
}

/** Invalidate a specific cache key (call after writes). */
export function invalidateCache(key: string): void {
  memoryCache.delete(key)
}

/** Invalidate everything that matches a prefix (e.g. "dashboard:"). */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key)
    }
  }
}
