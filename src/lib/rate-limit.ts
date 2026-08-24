// In-memory rate limiter for API routes
// Uses a Map with automatic cleanup of expired entries
//
// H-7 NOTE: In Vercel serverless, each cold start creates a fresh Map,
// so rate limits reset between cold starts. This still provides meaningful
// protection within a warm instance. For production-grade rate limiting,
// consider using Vercel KV, Upstash Redis, or similar external store.

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  var now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (var [key, entry] of store.entries()) {
    if (now >= entry.resetAt) {
      store.delete(key)
    }
  }
}

export interface RateLimitConfig {
  maxRequests: number
  windowSeconds: number
  keyPrefix?: string
}

export var RateLimitPresets = {
  auth: { maxRequests: 5, windowSeconds: 60, keyPrefix: 'auth' } as RateLimitConfig,
  write: { maxRequests: 30, windowSeconds: 60, keyPrefix: 'write' } as RateLimitConfig,
  read: { maxRequests: 60, windowSeconds: 60, keyPrefix: 'read' } as RateLimitConfig,
}

export function checkRateLimit(
  req: Request,
  config: RateLimitConfig
): { limited: boolean; retryAfter: number } {
  cleanup()

  var ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || req.headers.get('cf-connecting-ip')
    || 'unknown'

  var key = (config.keyPrefix || 'rl') + ':' + ip
  var now = Date.now()
  var windowMs = config.windowSeconds * 1000

  var entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false, retryAfter: 0 }
  }

  entry.count++

  if (entry.count > config.maxRequests) {
    // FIX: Added missing closing parenthesis that was breaking the build
    var retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { limited: true, retryAfter: retryAfter }
  }

  return { limited: false, retryAfter: 0 }
}
