// Server-only auth functions
// This file imports db, bcrypt, jose - all server-only modules
// MUST NOT be imported by client components (only used in API routes)

import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db } from './db'
import { SessionUser, SESSION_COOKIE, getSessionMaxAge, getCookieOptions } from './auth'

// v14 SECURITY: hash وهمي لمقارنات مستخدم غير موجود — تسوية زمن الدخول (منع timing enumeration)
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is not set or too short (min 32 chars)')
  }
  return new TextEncoder().encode(secret)
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  try {
    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) {
      // v14: نفس زمن المقارنة حتى لو لم يوجد المستخدم (منع تعداد البريدات بالتوقيت)
      await bcrypt.compare(password, DUMMY_HASH).catch(() => false)
      return null
    }
    if (!user.active) {
      await bcrypt.compare(password, DUMMY_HASH).catch(() => false)
      return null
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return null

    const permissions = user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions)
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
      tokenVersion: user.tokenVersion || 0,
      // v15: علم مدير النظام من قاعدة البيانات — مصدر الحقيقة الوحيد
      isSystemAdmin: (user as { isSystemAdmin?: boolean }).isSystemAdmin === true,
    }
  } catch (error) {
    // v20: خطأ قاعدة البيانات لم يعد يتنكر كبيانات دخول خاطئة (401) —
    // يُعاد رميه فيلتقطه المسار الخارجي لتسجيل الدخول ويعيد 500 برسالة
    // «فشل الاتصال بقاعدة البيانات» بدل تضليل المستخدم.
    console.error('verifyCredentials error:', error)
    throw error
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
      permissions: user.permissions || null,
      tv: user.tokenVersion ?? 0,
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

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  if (typeof token !== 'string') return null
  if (token.trim().length === 0) return null

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: 'axis-pipe-jacking',
      audience: 'axis-users',
    })

    const userId = payload.sub
    if (!userId) return null

    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user || !user.active) return null

    // v14 SECURITY: إبطال الجلسات — إذا رُفعت tokenVersion في قاعدة البيانات
    // (تغيير كلمة مرور/تعطيل) فإن كل التوكنات القديمة تصبح غير صالحة فوراً.
    var tokenTv = typeof payload.tv === 'number' ? payload.tv : 0
    if (tokenTv !== (user.tokenVersion || 0)) return null

    // FIX: الصلاحيات يجب أن تُقرأ من سجل قاعدة البيانات (الحالي) وليس من لقطة JWT
    // القديمة لحظة الدخول. الكود السابق كان يقرأ payload.permissions مع فحص
    // Array.isArray — وبما أن الجلسة تخزن الصلاحيات ككائن (أو null) كان الفحص
    // يُرجع [] دائماً، فلا تنطبق الصلاحيات المخصصة أبداً حتى بعد حفظها بنجاح.
    const permissions = (user.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions))
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
      tokenVersion: user.tokenVersion || 0,
      // v15: علم مدير النظام يُقرأ من قاعدة البيانات في كل طلب —
      // يسري فوراً حتى على الجلسات القديمة دون إعادة تسجيل دخول
      isSystemAdmin: (user as { isSystemAdmin?: boolean }).isSystemAdmin === true,
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


