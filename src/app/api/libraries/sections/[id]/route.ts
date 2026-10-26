// ─── v97: المكتبات — تعديل قسم / حذف قسم ───────────────────────────────────
// PATCH  /api/libraries/sections/[id] → تعديل الاسم أو الخصوصية (خاص/عام)
// DELETE /api/libraries/sections/[id] → حذف القسم وملفاته
// البوابة: صاحب القسم أو صاحب المكتبة أو مدير النظام
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageSection } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

async function loadSection(id: string) {
  return db.librarySection.findUnique({
    where: { id },
    select: { id: true, name: true, isPrivate: true, ownerId: true, libraryId: true, library: { select: { id: true, ownerId: true, name: true } } },
  })
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var section = await loadSection(id)
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    if (!canManageSection(user, section.ownerId, section.library.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل القسم لصاحب القسم أو صاحب المكتبة فقط' }, { status: 403 })
    }

    const body = await req.json()
    var data: { name?: string; isPrivate?: boolean } = {}
    if (body.name !== undefined) {
      var name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم مطلوب' }, { status: 400 })
      if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
      data.name = name
    }
    if (body.isPrivate !== undefined) {
      data.isPrivate = body.isPrivate === true
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothing_to_update', message: 'لا يوجد ما يُحدَّث' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.librarySection.update({ where: { id }, data, select: { id: true, name: true, isPrivate: true } }),
      'تعديل قسم المكتبة'
    )
    if (!result.success) return result.response
    return NextResponse.json({ section: result.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تعديل قسم المكتبة')
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

    var section = await loadSection(id)
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    if (!canManageSection(user, section.ownerId, section.library.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'حذف القسم لصاحب القسم أو صاحب المكتبة فقط' }, { status: 403 })
    }

    // ملفات القسم تُحذف معه تلقائياً (ON DELETE CASCADE)
    const result = await safeDbOp(() => db.librarySection.delete({ where: { id } }), 'حذف قسم المكتبة')
    if (!result.success) return result.response
    return NextResponse.json({ success: true, message: 'حُذف القسم بكل ملفاته' })
  } catch (error: any) {
    return handleDbError(error, 'حذف قسم المكتبة')
  }
}
