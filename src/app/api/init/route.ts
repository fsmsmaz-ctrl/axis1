import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    // Protect init endpoint with a secret key
    const authHeader = req.headers.get('authorization')
    const body = await req.json().catch(() => ({}))
    const initKey = body.initKey || authHeader?.replace('Bearer ', '')

    const expectedKey = process.env.INIT_SECRET_KEY
    if (expectedKey && initKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Step 1: Check if any users exist
    let userCount = 0
    try {
      userCount = await db.user.count()
    } catch (countError) {
      return NextResponse.json({
        error: 'Database tables not accessible',
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

    // Step 2: Create default admin user
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
      { error: 'Failed to initialize database' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    let userCount = 0
    let dbAccessible = true

    try {
      userCount = await db.user.count()
    } catch {
      dbAccessible = false
    }

    return NextResponse.json({
      needsInit: !dbAccessible || userCount === 0,
      userCount,
      dbAccessible,
    })
  } catch {
    return NextResponse.json(
      { needsInit: true, dbAccessible: false },
      { status: 200 }
    )
  }
}
