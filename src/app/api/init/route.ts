import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

// This endpoint seeds the database with default admin user if no users exist.
// Schema should be managed via `prisma db push`, NOT by raw SQL at runtime.

export async function POST() {
  try {
    // Step 1: Check if any users exist (schema must already be set up via prisma db push)
    let userCount = 0
    try {
      userCount = await db.user.count()
    } catch (countError) {
      return NextResponse.json({
        error: 'Database tables not accessible',
        details: String(countError),
        hint: 'Run `npx prisma migrate deploy` to apply migrations to Supabase',
      }, { status: 500 })
    }

    if (userCount > 0) {
      return NextResponse.json({
        initialized: false,
        message: 'Database already has users',
        userCount,
      })
    }

    // Step 2: Create default admin user with secure password
    const adminPassword = process.env.INIT_ADMIN_PASSWORD || 'Axis@2025!Secure'
    const passwordHash = await bcrypt.hash(adminPassword, 10)

    const createdUsers: string[] = []

    try {
      const admin = await db.user.create({
        data: {
          email: 'admin@axis.om',
          password: passwordHash,
          name: 'مدير النظام',
          nameEn: 'System Admin',
          phone: '+96891234567',
          role: 'top_management',
          language: 'ar',
          active: true,
        },
      })
      createdUsers.push(admin.email)
    } catch (e) {
      console.error('Failed to create admin:', e)
    }

    // Step 3: Create all default demo accounts
    const defaultUsers = [
      { email: 'ceo@axis.om', name: 'أحمد البلوشي', nameEn: 'Ahmed Al-Balushi', phone: '+96891234567', role: 'top_management' },
      { email: 'pm@axis.om', name: 'خالد الحبسي', nameEn: 'Khalid Al-Habsi', phone: '+96892345678', role: 'project_manager' },
      { email: 'engineer@axis.om', name: 'سالم الكندي', nameEn: 'Salem Al-Kindi', phone: '+96893456789', role: 'site_engineer' },
      { email: 'hse@axis.om', name: 'محمد العبري', nameEn: 'Mohammed Al-Abri', phone: '+96894567890', role: 'hse_officer' },
      { email: 'foreman@axis.om', name: 'ناصر الشحي', nameEn: 'Nasser Al-Shehhi', phone: '+96895678901', role: 'foreman' },
      { email: 'finance@axis.om', name: 'عائشة الرواحية', nameEn: 'Aisha Al-Rawahi', phone: '+96896789012', role: 'accountant' },
    ]

    for (const u of defaultUsers) {
      try {
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
        createdUsers.push(u.email)
      } catch (e) {
        console.error(`Failed to create user ${u.email}:`, e)
      }
    }

    if (createdUsers.length === 0) {
      return NextResponse.json({
        error: 'Failed to create any users',
        details: 'Database may not be writable',
      }, { status: 500 })
    }

    return NextResponse.json({
      initialized: true,
      message: 'Database initialized with default users',
      userCount: createdUsers.length,
      adminEmail: 'admin@axis.om',
      users: createdUsers,
    })
  } catch (error) {
    console.error('Init error:', error)
    return NextResponse.json(
      {
        error: 'Failed to initialize database',
        details: String(error),
      },
      { status: 500 }
    )
  }
}

// GET endpoint to check if database needs initialization
export async function GET() {
  try {
    let userCount = 0
    let dbAccessible = true

    try {
      userCount = await db.user.count()
    } catch (e) {
      dbAccessible = false
      console.error('DB not accessible:', e)
    }

    return NextResponse.json({
      needsInit: !dbAccessible || userCount === 0,
      userCount,
      dbAccessible,
    })
  } catch (error) {
    return NextResponse.json(
      { needsInit: true, dbAccessible: false, error: 'Database not accessible' },
      { status: 200 }
    )
  }
}