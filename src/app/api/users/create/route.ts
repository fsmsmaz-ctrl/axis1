import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = 'admin@axis.om'
const MAX_USERS = 6

const VALID_ROLES = [
  'top_management',
  'project_manager',
  'site_engineer',
  'hse_officer',
  'foreman',
  'accountant',
]

export async function POST(req: NextRequest) {
  try {
    // 1. Verify the requester is admin
    const authUser = await getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (authUser.email.toLowerCase().trim() !== ADMIN_EMAIL) {
      return NextResponse.json(
        { error: 'Access denied. Only the system admin can create users.' },
        { status: 403 }
      )
    }

    // 2. Check current user count (excluding admin)
    const currentUserCount = await db.user.count({
      where: { email: { not: ADMIN_EMAIL } }
    })

    if (currentUserCount >= MAX_USERS) {
      return NextResponse.json(
        { error: `Maximum user limit reached (${MAX_USERS} users). Cannot create more users.` },
        { status: 400 }
      )
    }

    // 3. Parse request body
    const body = await req.json()
    const { email, name, nameEn, password, role, phone } = body

    // 4. Validate required fields
    if (!email || !password || !name || !role) {
      return NextResponse.json(
        { error: 'Email, password, name, and role are required.' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format.' },
        { status: 400 }
      )
    }

    // Validate password (min 6 chars)
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 400 }
      )
    }

    // Validate role
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` },
        { status: 400 }
      )
    }

    // Check if email already exists
    const existing = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 }
      )
    }

    // 5. Hash password and create user
    const passwordHash = await bcrypt.hash(password, 10)

    const user = await db.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: passwordHash,
        name: name.trim(),
        nameEn: (nameEn || name).trim(),
        phone: phone ? phone.trim() : null,
        role,
        language: 'ar',
        active: true,
      },
    })

    // 6. Return user (without password)
    return NextResponse.json({
      message: 'User created successfully.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameEn: user.nameEn,
        role: user.role,
        phone: user.phone,
      },
      remainingSlots: MAX_USERS - currentUserCount - 1,
    })
  } catch (error: any) {
    console.error('Create user error:', error)

    // Handle unique constraint
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A user with this email already exists.' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create user.' },
      { status: 500 }
    )
  }
}