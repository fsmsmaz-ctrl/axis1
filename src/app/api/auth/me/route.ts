import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SESSION_COOKIE } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    // Clear any invalid/expired cookie so the client knows to re-authenticate
    const response = NextResponse.json({ user: null }, { status: 200 })
    // Check if there was a token (cookie or header)
    const hadCookie = req.cookies.get(SESSION_COOKIE)?.value
    const hadHeader = req.headers.get('authorization')
    if (hadCookie || hadHeader) {
      response.cookies.set(SESSION_COOKIE, '', {
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      })
    }
    return response
  }

  return NextResponse.json({ user })
}
