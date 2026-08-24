import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

// C-1 FIX: Removed /api/auth/logout from public paths (F-5)
var PUBLIC_PATHS = ['/api/auth/login', '/api/auth/me', '/api/init']

function getSecretKey(): Uint8Array {
  var secret = process.env.JWT_SECRET
  // C-1 FIX: No fallback key — reject if not configured
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET not configured or too short')
  }
  return new TextEncoder().encode(secret)
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(function(p) { return pathname === p || pathname.startsWith(p + '/') })
}

export async function middleware(req: NextRequest) {
  var pathname = req.nextUrl.pathname

  // Allow public API paths without auth
  if (isPublicPath(pathname)) {
    var response = NextResponse.next()
    addSecurityHeaders(response, pathname)
    return response
  }

  // Protect all /api/ routes
  if (pathname.startsWith('/api/')) {
    var token = req.cookies.get('axis_session')?.value

    if (!token) {
      var authHeader = req.headers.get('authorization')
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7)
      }
    }

    if (!token) {
      return NextResponse.json(
        { error: 'unauthorized', message: 'يجب تسجيل الدخول' },
        { status: 401 }
      )
    }

    // Verify token signature
    try {
      await jwtVerify(token, getSecretKey(), {
        issuer: 'axis-pipe-jacking',
        audience: 'axis-users',
      })
    } catch {
      return NextResponse.json(
        { error: 'unauthorized', message: 'انتهت الجلسة - يرجى إعادة تسجيل الدخول' },
        { status: 401 }
      )
    }

    var response = NextResponse.next()
    addSecurityHeaders(response, pathname)
    return response
  }

  var response2 = NextResponse.next()
  addSecurityHeaders(response2, pathname)
  return response2
}

function addSecurityHeaders(response: NextResponse, pathname: string) {
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.delete('X-Powered-By')

  if (pathname.startsWith('/api/')) {
    response.headers.set('Content-Security-Policy', "default-src 'self'")
  }
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon|logo|robots.txt).*)',
  ],
}
