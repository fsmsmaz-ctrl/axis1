import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, getCookieOptions } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE, '', {
    ...getCookieOptions(),
    maxAge: 0,
  })
  return response
}
