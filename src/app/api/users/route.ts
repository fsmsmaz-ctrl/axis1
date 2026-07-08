import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'

async function ensureColumn() {
  try { await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "permissions" TEXT DEFAULT '[]'`) } catch {}
}

export async function GET(req: NextRequest) {
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  await ensureColumn()
  try {
    const rows = await db.$queryRawUnsafe(`
      SELECT id, email, name, "nameEn", phone, role, active, language, permissions, "createdAt", "updatedAt"
      FROM "User" ORDER BY "createdAt" DESC
    `) as any[]
    const users = rows.map(r => ({
      ...r,
      permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : [],
    }))
    return NextResponse.json({ users })
  } catch (error) {
    return handleDbError(error, 'جلب المستخدمين')
  }
}

export async function POST(req: NextRequest) {
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  await ensureColumn()
  try {
    const body = await req.json()
    const { email, password, name, nameEn, phone, role, active, language, permissions } = body
    if (!email || !password || !name || !role) {
      return NextResponse.json({ error: 'missing_fields', message: 'البريد الإلكتروني والاسم وكلمة المرور والدور مطلوبون' }, { status: 400 })
    }
    const dup = await db.$queryRawUnsafe(`SELECT id FROM "User" WHERE LOWER(email) = LOWER(?)`, email.trim()) as any[]
    if (dup.length > 0) {
      return NextResponse.json({ error: 'duplicate_entry', message: 'البريد الإلكتروني مستخدم بالفعل' }, { status: 400 })
    }
    const hashed = await bcrypt.hash(password, 12)
    const id = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
    const perms = JSON.stringify(Array.isArray(permissions) ? permissions : [])
    await db.$executeRawUnsafe(`
      INSERT INTO "User" (id, email, password, name, "nameEn", phone, role, active, language, permissions, "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, id, email.trim().toLowerCase(), hashed, name.trim(), nameEn?.trim() || null, phone?.trim() || null, role, active !== false, language || 'ar', perms)
    return NextResponse.json({ success: true, userId: id })
  } catch (error) {
    return handleDbError(error, 'إنشاء المستخدم')
  }
}
