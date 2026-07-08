import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'

async function ensureColumn() {
  try { await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "permissions" TEXT DEFAULT '[]'`) } catch {}
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  await ensureColumn()
  try {
    const body = await req.json()
    const sets: string[] = ['"updatedAt" = datetime(\'now\')']
    const vals: any[] = []
    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name.trim()) }
    if (body.nameEn !== undefined) { sets.push('"nameEn" = ?'); vals.push(body.nameEn?.trim() || null) }
    if (body.phone !== undefined) { sets.push('phone = ?'); vals.push(body.phone?.trim() || null) }
    if (body.role !== undefined) { sets.push('role = ?'); vals.push(body.role) }
    if (body.active !== undefined) { sets.push('active = ?'); vals.push(body.active ? 1 : 0) }
    if (body.language !== undefined) { sets.push('language = ?'); vals.push(body.language) }
    if (body.permissions !== undefined) { sets.push('permissions = ?'); vals.push(JSON.stringify(body.permissions)) }
    if (body.password && body.password.trim()) {
      sets.push('password = ?')
      vals.push(await bcrypt.hash(body.password.trim(), 12))
    }
    if (vals.length === 0) {
      return NextResponse.json({ error: 'missing_fields', message: 'لم يتم تحديد أي حقل للتحديث' }, { status: 400 })
    }
    vals.push(id)
    await db.$executeRawUnsafe(`UPDATE "User" SET ${sets.join(', ')} WHERE id = ?`, ...vals)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'تحديث المستخدم')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (id === me.id) return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك حذف حسابك الخاص' }, { status: 403 })
  try {
    await db.$executeRawUnsafe(`DELETE FROM "User" WHERE id = ?`, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف المستخدم')
  }
}
