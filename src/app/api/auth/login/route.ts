import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, getSessionMaxAge, getCookieOptions, SESSION_COOKIE } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

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

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim()

    // Check if any users exist in the database
    let userCount = 0
    try {
      userCount = await db.user.count()
    } catch (e) {
      console.error('Database error during login:', e)
      return NextResponse.json(
        { error: 'database_error', message: 'Database not accessible. Please initialize the database first.' },
        { status: 500 }
      )
    }

    // If no users exist, auto-create the default admin user
    if (userCount === 0) {
      console.log('No users found, auto-creating default admin user...')
      try {
        const adminPassword = process.env.INIT_ADMIN_PASSWORD || 'Axis@2025!Secure'
        const passwordHash = await bcrypt.hash(adminPassword, 10)

        const defaultUsers = [
          { email: 'admin@axis.om', name: 'مدير النظام', nameEn: 'System Admin', phone: '+96891234567', role: 'top_management' },
          { email: 'ceo@axis.om', name: 'أحمد البلوشي', nameEn: 'Ahmed Al-Balushi', phone: '+96891234567', role: 'top_management' },
          { email: 'pm@axis.om', name: 'خالد الحبسي', nameEn: 'Khalid Al-Habsi', phone: '+96892345678', role: 'project_manager' },
          { email: 'engineer@axis.om', name: 'سالم الكندي', nameEn: 'Salem Al-Kindi', phone: '+96893456789', role: 'site_engineer' },
          { email: 'hse@axis.om', name: 'محمد العبري', nameEn: 'Mohammed Al-Abri', phone: '+96894567890', role: 'hse_officer' },
          { email: 'foreman@axis.om', name: 'ناصر الشحي', nameEn: 'Nasser Al-Shehhi', phone: '+96895678901', role: 'foreman' },
          { email: 'finance@axis.om', name: 'عائشة الرواحية', nameEn: 'Aisha Al-Rawahi', phone: '+96896789012', role: 'accountant' },
        ]

        for (const u of defaultUsers) {
          await db.user.create({
            data: {
              email: u.email,
              password: passwordHash,
              name: u.name,
              nameEn: u.nameEn,
              phone: u.phone,
              role: u.role,
              language: 'ar',
              active: true,
            },
          })
        }
        console.log(`Auto-created ${defaultUsers.length} default users`)
      } catch (createError) {
        console.error('Failed to auto-create users:', createError)
        return NextResponse.json(
          { error: 'init_failed', message: 'Failed to create default users. Please run /api/init manually.' },
          { status: 500 }
        )
      }
    }

    // Now verify credentials
    const user = await verifyCredentials(normalizedEmail, password)
    if (!user) {
      return NextResponse.json(
        { error: 'invalidCredentials', message: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Create signed JWT token
    const token = await createSession(user)

    // Update last login timestamp
    try {
      await db.user.update({
        where: { id: user.id },
        data: { updatedAt: new Date() },
      })
    } catch (e) {
      // Non-critical error, continue
      console.log('Failed to update last login:', e)
    }

    // Set cookie + return token in response body
    const response = NextResponse.json({ user, token })
    response.cookies.set(SESSION_COOKIE, token, getCookieOptions())

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'internal_error', message: String(error) },
      { status: 500 }
    )
  }
}
