import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { handleDbError } from '@/lib/api-helpers'

const ADMIN_EMAIL = 'admin@axis.om'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'top_management') return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const body = await req.json()
    const updateData: Record<string, any> = {}

    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.nameEn !== undefined) updateData.nameEn = body.nameEn?.trim() || null
    if (body.phone !== undefined) updateData.phone = body.phone?.trim() || null
    if (body.role !== undefined) updateData.role = body.role
    if (body.active !== undefined) updateData.active = body.active
    if (body.language !== undefined) updateData.language = body.language

    if (body.permissions !== undefined) {
      const VALID_PERMS = [
        'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'performance',
        'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
        'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
        'rpt_weekly', 'rpt_monthly', 'rpt_handover',
      ]
      const cleanPerms: Record<string, boolean> = {}
      if (body.permissions && typeof body.permissions === 'object') {
        for (const key of VALID_PERMS) {
          if (typeof body.permissions[key] === 'boolean') {
            cleanPerms[key] = body.permissions[key]
          }
        }
      }
      updateData.permissions = Object.keys(cleanPerms).length > 0 ? cleanPerms : null
    }

    if (body.password && body.password.trim()) {
      updateData.password = await bcrypt.hash(body.password.trim(), 12)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'missing_fields', message: 'لم يتم تحديد أي حقل للتحديث' }, { status: 400 })
    }

    await db.user.update({
      where: { id },
      data: updateData,
    })

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
    await db.user.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف المستخدم')
  }
}
