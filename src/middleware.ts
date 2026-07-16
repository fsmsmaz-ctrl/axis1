import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const SESSION_COOKIE = 'axis_session'
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/init', '/_next', '/favicon', '/logo']

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is not set or too short')
  }
  return new TextEncoder().encode(secret)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow static files and public assets
  if (pathname.startsWith('/_next/static/') || pathname.startsWith('/logo') || pathname === '/robots.txt') {
    return NextResponse.next()
  }

  // Check for session cookie or Authorization header
  const token = request.cookies.get(SESSION_COOKIE)?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) {
    // For API routes, return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    // For page routes, redirect to login
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  try {
    await jwtVerify(token, getSecretKey(), {
      issuer: 'axis-pipe-jacking',
      audience: 'axis-users',
    })
    return NextResponse.next()
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'session_expired' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon|logo|robots.txt).*)',
  ],
}