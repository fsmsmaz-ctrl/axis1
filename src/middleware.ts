import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

var PUBLIC_PATHS = ['/api/auth', '/api/init']

function getSecretKey(): Uint8Array {
  var secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) return new TextEncoder().encode('fallback-secret-key-for-middleware-check-only')
  return new TextEncoder().encode(secret)
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(function(p) { return pathname === p || pathname.startsWith(p + '/') })
}

export async function middleware(req: NextRequest) {
  var pathname = req.nextUrl.pathname

  // Allow public API paths (login, init) without auth
  if (isPublicPath(pathname)) {
    // Add security headers to all responses
    var response = NextResponse.next()
    addSecurityHeaders(response, pathname)
    return response
  }

  // Protect all /api/ routes
  if (pathname.startsWith('/api/')) {
    var token = req.cookies.get('axis_session')?.value

    if (!token) {
      // Check Authorization header as fallback
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

    // Verify token signature (quick check - full validation happens in route handlers)
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

  // Non-API routes: add security headers
  var response2 = NextResponse.next()
  addSecurityHeaders(response2, pathname)
  return response2
}

function addSecurityHeaders(response: NextResponse, pathname: string) {
  // Prevent framing
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  // Prevent MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')
  // XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block')
  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // HSTS
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Prevent info leakage
  response.headers.set('X-Powered-By', 'AXIS')

  // Content Security Policy for API routes
  if (pathname.startsWith('/api/')) {
    response.headers.set('Content-Security-Policy', "default-src 'self'")
  }
}

export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
    // Match all page routes
    '/((?!_next/static|_next/image|favicon|logo|robots.txt).*)',
  ],
}
