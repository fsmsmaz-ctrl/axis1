import { NextResponse } from 'next/server'
import { SESSION_COOKIE, getCookieOptions } from '@/lib/auth'

export async function POST() {
  const response = NextResponse.json({ success: true })
  // Clear the session cookie — attributes MUST match how it was set
  response.cookies.set(SESSION_COOKIE, '', {
    ...getCookieOptions(),
    maxAge: 0,
  })
  return response
}
