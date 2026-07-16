import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, getSessionMaxAge, getCookieOptions, SESSION_COOKIE } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    const user = await verifyCredentials(normalizedEmail, password)
    if (!user) {
      return NextResponse.json(
        { error: 'invalidCredentials', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    const token = await createSession(user)

    try {
      await db.user.update({
        where: { id: user.id },
        data: { updatedAt: new Date() },
      })
    } catch {}

    const response = NextResponse.json({ user, token })
    response.cookies.set(SESSION_COOKIE, token, getCookieOptions())

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: 'An error occurred during login. Please try again.' },
      { status: 500 }
    )
  }
}