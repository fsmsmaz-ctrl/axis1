import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SESSION_COOKIE, getCookieOptions } from '@/lib/auth'

// F-5 FIX: Require authentication before logout
export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE, '', {
    ...getCookieOptions(),
    maxAge: 0,
  })
  return response
}
