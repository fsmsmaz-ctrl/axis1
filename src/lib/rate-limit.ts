// In-memory rate limiter for API routes
// Uses a Map with automatic cleanup of expired entries
// Suitable for Netlify serverless (single instance per request, but Map persists within cold start)

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries every 5 minutes
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
  // Maximum number of requests in the window
  maxRequests: number
  // Time window in seconds
  windowSeconds: number
  // Custom identifier (defaults to IP address)
  keyPrefix?: string
}

// Preset configurations
export var RateLimitPresets = {
  // Strict: for login and sensitive auth operations
  auth: { maxRequests: 5, windowSeconds: 60, keyPrefix: 'auth' } as RateLimitConfig,
  // Moderate: for general API writes (create, update, delete)
  write: { maxRequests: 30, windowSeconds: 60, keyPrefix: 'write' } as RateLimitConfig,
  // Relaxed: for read-only operations
  read: { maxRequests: 60, windowSeconds: 60, keyPrefix: 'read' } as RateLimitConfig,
}

/**
 * Check if a request should be rate limited.
 * Call this at the start of your API route handler.
 *
 * @param req - The Next.js request object
 * @param config - Rate limit configuration (use RateLimitPresets or custom)
 * @returns { limited: boolean, retryAfter: number } - If limited=true, reject the request
 *
 * @example
 * // In an API route:
 * import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
 *
 * export async function POST(req: NextRequest) {
 *   var rl = checkRateLimit(req, RateLimitPresets.auth)
 *   if (rl.limited) {
 *     return NextResponse.json(
 *       { error: 'too_many_requests', message: '太多请求，请稍后再试' },
 *       { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
 *     )
 *   }
 *   // ... rest of handler
 * }
 */
export function checkRateLimit(
  req: Request,
  config: RateLimitConfig
): { limited: boolean; retryAfter: number } {
  cleanup()

  // Get client IP
  var ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || req.headers.get('cf-connecting-ip')
    || 'unknown'

  var key = (config.keyPrefix || 'rl') + ':' + ip
  var now = Date.now()
  var windowMs = config.windowSeconds * 1000

  var entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false, retryAfter: 0 }
  }

  entry.count++

  if (entry.count > config.maxRequests) {
    var retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { limited: true, retryAfter: retryAfter }
  }

  return { limited: false, retryAfter: 0 }
}
