// Server-only auth functions
// This file imports db, bcrypt, jose - all server-only modules
// MUST NOT be imported by client components (only used in API routes)

import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db } from './db'
import { SessionUser, SESSION_COOKIE, getSessionMaxAge, getCookieOptions } from './auth'

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET environment variable is required and must be at least 32 characters. ' +
      'Generate one with: openssl rand -base64 48'
    )
  }
  return new TextEncoder().encode(secret)
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  try {
    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return null
    if (!user.active) return null

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return null

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      phone: user.phone,
      language: user.language,
    }
  } catch (error) {
    console.error('verifyCredentials error:', error)
    return null
  }
}

export async function createSession(user: SessionUser): Promise<string> {
  try {
    const token = await new SignJWT({
      sub: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn || null,
      role: user.role,
      phone: user.phone || null,
      language: user.language,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer('axis-pipe-jacking')
      .setAudience('axis-users')
      .setExpirationTime(`${getSessionMaxAge()}s`)
      .sign(getSecretKey())

    return token
  } catch (error) {
    console.error('createSession error:', error)
    throw error
  }
}

// ==================== Session Cache ====================
// Caches verified user for 30 seconds to avoid a DB query on EVERY API call
const sessionCache = new Map<string, { user: SessionUser | null; ts: number }>()
const SESSION_CACHE_TTL = 30_000

// Clean expired entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of sessionCache) {
    if (now - entry.ts > SESSION_CACHE_TTL) sessionCache.delete(key)
  }
}, 300_000)

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  if (typeof token !== 'string') return null
  if (token.trim().length === 0) return null

  // Check cache first
  const cached = sessionCache.get(token)
  if (cached && Date.now() - cached.ts < SESSION_CACHE_TTL) {
    return cached.user
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: 'axis-pipe-jacking',
      audience: 'axis-users',
    })

    const userId = payload.sub
    if (!userId) return null

    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || !user.active) {
      sessionCache.set(token, { user: null, ts: Date.now() })
      return null
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      phone: user.phone,
      language: user.language,
    }

    sessionCache.set(token, { user: sessionUser, ts: Date.now() })
    return sessionUser
  } catch (error) {
    return null
  }
}

// Re-export shared items for server-side use
export { SESSION_COOKIE, getSessionMaxAge, getCookieOptions }
export type { SessionUser }

import type { NextRequest } from 'next/server'

/**
 * Extract the JWT token from request (cookie OR Authorization header)
 */
export function extractToken(req: NextRequest): string | undefined {
  let token = req.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
  }

  return token
}

/**
 * Get the authenticated user from request
 */
export async function getAuthUser(req: NextRequest): Promise<SessionUser | null> {
  const token = extractToken(req)
  return await getSessionUser(token)
}
