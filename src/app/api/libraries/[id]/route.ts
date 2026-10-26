// ─── v97: المكتبات — تفاصيل مكتبة / تعديل / حذف ────────────────────────────
// PATCH  /api/libraries/[id] → تعديل الاسم والوصف (صاحب المكتبة ومدير النظام)
// DELETE /api/libraries/[id] → حذف المكتبة وأقسامها وملفاتها (صاحبها ومدير النظام)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { filterVisibleSections, isLibraryAdmin, canManageLibrary } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({ where: { id }, select: { id: true, ownerId: true } })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    if (!canManageLibrary(user, lib.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل المكتبة لصاحبها فقط' }, { status: 403 })
    }

    const body = await req.json()
    var data: { name?: string; description?: string | null } = {}
    if (body.name !== undefined) {
      var name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة مطلوب' }, { status: 400 })
      if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
      data.name = name
    }
    if (body.description !== undefined) {
      data.description = body.description != null ? String(body.description).trim().slice(0, 500) : null
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothing_to_update', message: 'لا يوجد ما يُحدَّث' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.library.update({ where: { id }, data, select: { id: true, name: true, description: true } }),
      'تعديل المكتبة'
    )
    if (!result.success) return result.response
    return NextResponse.json({ library: result.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تعديل المكتبة')
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    if (!canManageLibrary(user, lib.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'حذف المكتبة لصاحبها فقط' }, { status: 403 })
    }

    // الحذف يتسلسل تلقائياً: الأقسام ثم الملفات (ON DELETE CASCADE)
    const result = await safeDbOp(() => db.library.delete({ where: { id } }), 'حذف المكتبة')
    if (!result.success) return result.response
    return NextResponse.json({ success: true, message: 'حُذفت المكتبة بكل أقسامها وملفاتها' })
  } catch (error: any) {
    return handleDbError(error, 'حذف المكتبة')
  }
}
