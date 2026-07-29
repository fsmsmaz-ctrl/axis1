// Server-only auth functions
// This file imports db, bcrypt, jose - all server-only modules
// MUST NOT be imported by client components (only used in API routes)

import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db } from './db'
import { SessionUser, SESSION_COOKIE, getSessionMaxAge, getCookieOptions } from './auth'

function getSecretKey(): Uint8Array {
  var secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is not set or too short (min 32 chars)')
  }
  return new TextEncoder().encode(secret)
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  try {
    var user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) return null
    if (!user.active) return null

    var valid = await bcrypt.compare(password, user.password)
    if (!valid) return null

    var permissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions)
      ? user.permissions as Record<string, boolean>
      : null

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      phone: user.phone,
      language: user.language,
      permissions,
    }
  } catch (error) {
    console.error('verifyCredentials error:', error)
    return null
  }
}

export async function createSession(user: SessionUser): Promise<string> {
  try {
    var token = await new SignJWT({
      sub: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn || null,
      role: user.role,
      phone: user.phone || null,
      language: user.language,
      permissions: user.permissions || null,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer('axis-pipe-jacking')
      .setAudience('axis-users')
      .setExpirationTime(String(getSessionMaxAge()) + 's')
      .sign(getSecretKey())

    return token
  } catch (error) {
    console.error('createSession error:', error)
    throw error
  }
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  if (typeof token !== 'string') return null
  if (token.trim().length === 0) return null

  try {
    var result = await jwtVerify(token, getSecretKey(), {
      issuer: 'axis-pipe-jacking',
      audience: 'axis-users',
    })

    var payload = result.payload
    var userId = payload.sub
    if (!userId) return null

    var user = await db.user.findUnique({ where: { id: userId as string } })
    if (!user || !user.active) return null

    // Get permissions from database (source of truth) not from token
    var dbPermissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions)
      ? user.permissions as Record<string, boolean>
      : null

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nameEn: user.nameEn,
      role: user.role,
      phone: user.phone,
      language: user.language,
      permissions: dbPermissions,
    }
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
  var token = req.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    var authHeader = req.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    }
  }

  return token
}

/**
 * Get the authenticated user from request
 */
export async function getAuthUser(req: NextRequest): Promise<SessionUser | null> {
  var token = extractToken(req)
  return await getSessionUser(token)
}
