// ─── v97: المكتبات — تفاصيل مكتبة / تعديل / حذف ────────────────────────────
// GET    /api/libraries/[id]?t=<token> → بيانات مكتبة وأقسامها المرئية
//        (v100: أساس فتح «رابط الوصول» للمكتبة — من يملك الرابط بتوكنه الصحيح
//        يرى المكتبة حتى لو كانت مخفية عن القوائم؛ الخاصة لا تُفتح برابط أبداً)
// PATCH  /api/libraries/[id] → تعديل الاسم والوصف والرؤية (صاحب المكتبة ومدير النظام)
// DELETE /api/libraries/[id] → حذف المكتبة وأقسامها وملفاتها (صاحبها ومدير النظام)
// v100 — القاعدة الذهبية: تغيير رؤية المكتبة يقيّد كل ما داخلها تلقائياً
// (الأضيق يفوز) — مكتبة تصير خاصة تجعل كل أقسامها وملفاتها خاصة فعلياً فوراً.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { filterVisibleSections, isLibraryAdmin, canManageLibrary, canOpenLibraryByToken } from '@/lib/libraries'

type RouteParams = { params: Promise<{ id: string }> }

// ─── v100: مكتبة واحدة — بوابة رابط الوصول + أساس عرض المكتبة المباشر ───────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({
      where: { id },
      select: {
        id: true, name: true, description: true, visibility: true, linkToken: true, ownerId: true, createdAt: true,
        owner: { select: { id: true, name: true, nameEn: true } },
        _count: { select: { files: true } },
        sections: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, name: true, isPrivate: true, linkToken: true, ownerId: true, createdAt: true,
            owner: { select: { id: true, name: true, nameEn: true } },
            _count: { select: { files: true } },
          },
        },
      },
    })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })

    // التوكن من استعلام الرابط فقط — مكتبة «برابط» تُفتح به حتى وهي مخفية عن القوائم،
    // والخاصة لا تُفتح برابط أبداً (لصاحبها ومدير النظام فقط)
    var token = req.nextUrl.searchParams.get('t')
    if (!canOpenLibraryByToken(user, lib, token)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذه المكتبة محمية — تُفتح برابط الوصول الخاص بها أو لصاحبها' }, { status: 403 })
    }

    var admin = isLibraryAdmin(user)
    var manager = canManageLibrary(user, lib.ownerId)
    var visible = admin || manager ? lib.sections : filterVisibleSections(user, lib.sections, lib)
    var allSectionFiles = lib.sections.reduce((acc, s) => acc + s._count.files, 0)
    var directCount = Math.max(0, lib._count.files - allSectionFiles)
    // تثبيت القيم للاستخدام داخل الدوال المغلقة (تضييق النوع لا يعبر حدود الإغلاقات)
    var libOwnerId = lib.ownerId

    return NextResponse.json({
      library: {
        id: lib.id,
        name: lib.name,
        description: lib.description,
        visibility: lib.visibility,
        // التوكن يُسلَّم لمدرّي المكتبة فقط — لا يصل أصلاً لغيرهم
        linkToken: manager ? lib.linkToken : undefined,
        ownerId: lib.ownerId,
        createdAt: lib.createdAt,
        owner: lib.owner,
        isMine: lib.ownerId === user.id,
        canManage: manager,
        sectionCount: visible.length,
        fileCount: visible.reduce((acc, s) => acc + s._count.files, 0) + directCount,
        directFileCount: directCount,
        sections: visible.map((s) => ({
          id: s.id,
          name: s.name,
          isPrivate: s.isPrivate,
          createdAt: s.createdAt,
          ownerId: s.ownerId,
          owner: s.owner,
          fileCount: s._count.files,
          linkToken: (admin || s.ownerId === user.id || libOwnerId === user.id) ? s.linkToken : undefined,
        })),
      },
    })
  } catch (error: any) {
    return handleDbError(error, 'تحميل المكتبة')
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    var lib = await db.library.findUnique({ where: { id }, select: { id: true, ownerId: true, visibility: true, linkToken: true } })
    if (!lib) return NextResponse.json({ error: 'not_found', message: 'المكتبة غير موجودة' }, { status: 404 })
    if (!canManageLibrary(user, lib.ownerId)) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل المكتبة لصاحبها فقط' }, { status: 403 })
    }

    const body = await req.json()
    var data: { name?: string; description?: string | null; visibility?: string; linkToken?: string | null } = {}
    if (body.name !== undefined) {
      var name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة مطلوب' }, { status: 400 })
      if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
      data.name = name
    }
    if (body.description !== undefined) {
      data.description = body.description != null ? String(body.description).trim().slice(0, 500) : null
    }
    // v100: تغيير رؤية المكتبة — والدخول لوضع «برابط» يولّد رمزاً إن لم يوجد،
    // ومغادرة الوضع تُبطل الرمز القديم (روابط سابقة تموت فوراً — لا ثغرات معلقة)
    var newVisibility: string | null = null
    if (body.visibility !== undefined) {
      if (body.visibility !== 'public' && body.visibility !== 'private' && body.visibility !== 'link') {
        return NextResponse.json({ error: 'invalid_visibility', message: 'رؤية غير معروفة — الاختيارات: عامة أو خاصة أو لمن يمتلك الرابط' }, { status: 400 })
      }
      newVisibility = String(body.visibility)
      data.visibility = newVisibility
    }
    var wantRegen = body.linkToken === 'generate'
    var effVisibility = newVisibility || lib.visibility
    if (newVisibility && newVisibility !== 'link') {
      // مغادرة وضع «برابط» تُبطل الرمز القديم — الروابط السابقة تموت فوراً
      data.linkToken = null
    } else if (effVisibility === 'link' && (wantRegen || (newVisibility === 'link' && !lib.linkToken))) {
      // توليد رمز عند: طلب صريح بالتدوير، أو دخول وضع «برابط» أول مرة بلا رمز
      data.linkToken = randomBytes(16).toString('hex')
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothing_to_update', message: 'لا يوجد ما يُحدَّث' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.library.update({ where: { id }, data, select: { id: true, name: true, description: true, visibility: true, linkToken: true } }),
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

    // الحذف يتسلسل تلقائياً: الأقسام ثم الملفات (ON DELETE CASCADE — وشامل الملفات المباشرة v100)
    const result = await safeDbOp(() => db.library.delete({ where: { id } }), 'حذف المكتبة')
    if (!result.success) return result.response
    return NextResponse.json({ success: true, message: 'حُذفت المكتبة بكل أقسامها وملفاتها' })
  } catch (error: any) {
    return handleDbError(error, 'حذف المكتبة')
  }
}
