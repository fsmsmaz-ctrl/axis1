// ─── v97: المكتبات — تحميل/حذف ملف واحد ────────────────────────────────────
// GET    /api/libraries/files/[id] → محتوى الملف (يُطبَّق فحص خصوصية القسم)
// DELETE /api/libraries/files/[id] → حذف الملف (الرافع أو صاحب القسم/المكتبة ومدير النظام)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageSection, canViewSection } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

async function loadFileWithSection(id: string) {
  return db.libraryFile.findUnique({
    where: { id },
    select: {
      id: true, fileName: true, fileType: true, url: true, size: true, uploaderId: true, createdAt: true,
      section: { select: { id: true, isPrivate: true, ownerId: true, name: true, library: { select: { id: true, ownerId: true, name: true } } } },
    },
  })
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    await ensureLibrariesSupport()

    var file = await loadFileWithSection(id)
    if (!file) return NextResponse.json({ error: 'not_found', message: 'الملف غير موجود' }, { status: 404 })
    // فحص الخصوصية: ملف قسم خاص لا يُسلَّم لغير صاحبه ومدير النظام — خادمياً
    if (!canViewSection(user, file.section)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذا الملف في قسم خاص بصاحبه' }, { status: 403 })
    }

    return NextResponse.json({
      file: { id: file.id, fileName: file.fileName, fileType: file.fileType, url: file.url, size: file.size },
    })
  } catch (error: any) {
    return handleDbError(error, 'تحميل ملف المكتبة')
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

    var file = await loadFileWithSection(id)
    if (!file) return NextResponse.json({ error: 'not_found', message: 'الملف غير موجود' }, { status: 404 })
    var allowed = file.uploaderId === user.id || canManageSection(user, file.section.ownerId, file.section.library.ownerId)
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden', message: 'حذف الملف لرافعه أو لصاحب القسم أو المكتبة فقط' }, { status: 403 })
    }

    const result = await safeDbOp(() => db.libraryFile.delete({ where: { id } }), 'حذف ملف مكتبة')
    if (!result.success) return result.response
    return NextResponse.json({ success: true, message: 'حُذف الملف' })
  } catch (error: any) {
    return handleDbError(error, 'حذف ملف مكتبة')
  }
}
