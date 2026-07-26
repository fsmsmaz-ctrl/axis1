import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SESSION_COOKIE, getCookieOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    // Clear any invalid/expired cookie so the client knows to re-authenticate
    const response = NextResponse.json({ user: null }, { status: 200 })
    // Check if there was a token (cookie or header)
    const hadCookie = req.cookies.get(SESSION_COOKIE)?.value
    const hadHeader = req.headers.get('authorization')
    if (hadCookie || hadHeader) {
      // Cookie attributes MUST match how it was set, otherwise the browser won't clear it
      response.cookies.set(SESSION_COOKIE, '', {
        ...getCookieOptions(),
        maxAge: 0,
      })
    }
    return response
  }

  return NextResponse.json({ user })
}
