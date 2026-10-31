// ─── v97: المكتبات — تحميل/حذف ملف واحد ────────────────────────────────────
// GET    /api/libraries/files/[id]?t=<token> → محتوى الملف (فحص خصوصية القسم
//        والمكتبة — v100: توكن رابط المكتبة يفتح ملفاتها أيضاً)
// DELETE /api/libraries/files/[id] → حذف الملف (الرافع أو صاحب القسم/المكتبة ومدير النظام)
// v100: الملف إما داخل قسم أو مرفوع مباشرة على المكتبة — كلاهما يعبر بوابة
// المكتبة أولاً (القاعدة الذهبية: الخاص يبقى خاصاً مهما كان السبب)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageLibrary, canManageSection, canViewSection } from '@/lib/libraries'
import { effectiveSectionMode } from '@/lib/lib-visibility'

type RouteParams = { params: Promise<{ id: string }> }

// v100: تحميل الملف مع مكتبته مباشرة (وقسمه إن وُجد — ملفات المكتبة المباشرة بلا قسم)
async function loadFile(id: string) {
  return db.libraryFile.findUnique({
    where: { id },
    select: {
      id: true, fileName: true, fileType: true, url: true, size: true, uploaderId: true, createdAt: true,
      sectionId: true,
      library: { select: { id: true, ownerId: true, name: true, visibility: true, linkToken: true } },
      section: { select: { id: true, isPrivate: true, ownerId: true, name: true, linkToken: true } },
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

    var file = await loadFile(id)
    if (!file) return NextResponse.json({ error: 'not_found', message: 'الملف غير موجود' }, { status: 404 })

    // فحص الرؤية خادمياً: بوابة المكتبة أولاً (خاصة → صاحبها فقط، برابط → توكنها)،
    // ثم خصوصية القسم إن كان الملف داخله. ملف المكتبة المباشر يُعامَل كقسم عام
    // بلا توكن خاص فيمر من بوابة مكتبته حصراً — لا تسريب بأي سبب.
    var token = req.nextUrl.searchParams.get('t')
    var pseudoSection = file.section || { isPrivate: false, ownerId: file.library.ownerId, linkToken: null }
    if (!canViewSection(user, pseudoSection, token, file.library.ownerId, file.library)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذا الملف في مكتبة أو قسم خاص بصاحبه' }, { status: 403 })
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

    var file = await loadFile(id)
    if (!file) return NextResponse.json({ error: 'not_found', message: 'الملف غير موجود' }, { status: 404 })
    // الحذف: الرافع نفسه، أو صاحب المكتبة/صاحب القسم إن كان الملف داخله —
    // v101: كلاهما يمر ببوابة الخاص الفعلي (خاصة المكتبة أو الخاص الفعلي للقسم →
    // صاحبها حصراً بلا استثناء للإدارة — الإدارة لا تحذف ما لا تراه)
    var allowed = file.uploaderId === user.id || canManageLibrary(user, file.library.ownerId, file.library.visibility)
    if (!allowed && file.section) {
      allowed = canManageSection(user, file.section.ownerId, file.library.ownerId, effectiveSectionMode(file.library, file.section))
    }
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
