// ─── v97: المكتبات — تعديل قسم / حذف قسم ───────────────────────────────────
// PATCH  /api/libraries/sections/[id] → تعديل الاسم أو الرؤية (خاص/عام/برابط)
// DELETE /api/libraries/sections/[id] → حذف القسم وملفاته
// v98: GET  /api/libraries/sections/[id]?t=<token> → قسم واحد ببياناته —
//        أساس فتح «رابط الوصول»: من يملك الرابط (بالتوكن الصحيح) يرى القسم
//        حتى لو كان مخفياً عن القوائم، بينما تُسلَّم بياناته بلا توكن لها أصلاً.
// البوابة: صاحب القسم أو صاحب المكتبة أو مدير النظام (للتعديل والحذف)
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { canManageSection, canViewSection } from '@/lib/libraries'
import { allowedSectionModes, sectionModeOf, effectiveSectionMode } from '@/lib/lib-visibility'

type RouteParams = { params: Promise<{ id: string }> }

async function loadSection(id: string) {
  return db.librarySection.findUnique({
    where: { id },
    select: {
      id: true, name: true, isPrivate: true, linkToken: true, ownerId: true, createdAt: true,
      // v100: بوابة المكتبة كاملة (الرؤية + التوكن) — الحكم لا يمر دونها
      library: { select: { id: true, ownerId: true, name: true, visibility: true, linkToken: true } },
    },
  })
}

// ─── v98: قسم واحد — بوابة رابط الوصول ─────────────────────────────────────
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    await ensureLibrariesSupport()

    var section = await loadSection(id)
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })

    // التوكن من استعلام الرابط فقط — قسما «برابط» يُفتح به حتى وهو مخفي عن القوائم
    // (v100: توكن مكتبة «برابط» يفتح أيضاً أقسامها — الحكم كله خادمياً)
    var token = req.nextUrl.searchParams.get('t')
    if (!canViewSection(user, section, token, section.library.ownerId, section.library)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذا القسم محمي — يُفتح برابط الوصول الخاص به أو لصاحبه' }, { status: 403 })
    }

    var fileCount = await db.libraryFile.count({ where: { sectionId: id } })
    // v101: الإدارة تمر ببوابة الخاص الفعلي — القسم الخاص بصاحبيه حصراً
    var manager = canManageSection(user, section.ownerId, section.library.ownerId, effectiveSectionMode(section.library, section))

    return NextResponse.json({
      section: {
        id: section.id,
        name: section.name,
        isPrivate: section.isPrivate,
        // التوكن يُسلَّم للمدرّين فقط — لا يصل أصلاً لغيرهم
        linkToken: manager ? section.linkToken : undefined,
        ownerId: section.ownerId,
        createdAt: section.createdAt,
        fileCount,
        library: {
          id: section.library.id,
          name: section.library.name,
          ownerId: section.library.ownerId,
          visibility: section.library.visibility,
        },
        canManage: manager,
      },
    })
  } catch (error: any) {
    return handleDbError(error, 'تحميل قسم المكتبة')
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

    var section = await loadSection(id)
    if (!section) return NextResponse.json({ error: 'not_found', message: 'القسم غير موجود' }, { status: 404 })
    // v101: الخاص الفعلي يُدار بصاحبي القسم/المكتبة حصراً — الإدارة مستثناة
    if (!canManageSection(user, section.ownerId, section.library.ownerId, effectiveSectionMode(section.library, section))) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل القسم لصاحب القسم أو صاحب المكتبة فقط' }, { status: 403 })
    }

    const body = await req.json()
    var data: { name?: string; isPrivate?: boolean; linkToken?: string | null } = {}
    if (body.name !== undefined) {
      var name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم مطلوب' }, { status: 400 })
      if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم القسم طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
      data.name = name
    }
    if (body.isPrivate !== undefined) {
      data.isPrivate = body.isPrivate === true
    }
    // v98: الرؤية «برابط» — 'generate' يولّد رمزاً جديداً (وإبطال أي رمز قديم)،
    // وnull يُلغي الوضع (يرجع القسم إلى خاص/عام حسب isPrivate)
    if (body.linkToken === 'generate') {
      data.linkToken = randomBytes(16).toString('hex')
    } else if (body.linkToken === null) {
      data.linkToken = null
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'nothing_to_update', message: 'لا يوجد ما يُحدَّث' }, { status: 400 })
    }

    // v100: القاعدة الذهبية عند التعديل — أي محاولة لجعل القسم أوسع من مكتبته تُرفض
    // (لا قسم عام أو برابط داخل مكتبة خاصة، ولا قسم عام داخل مكتبة «برابط»)
    if (data.isPrivate !== undefined || data.linkToken !== undefined) {
      var nextIsPrivate = data.isPrivate !== undefined ? data.isPrivate : section.isPrivate
      var nextToken = data.linkToken !== undefined ? data.linkToken : section.linkToken
      var nextMode = sectionModeOf({ isPrivate: nextIsPrivate, linkToken: nextToken })
      var allowed = allowedSectionModes(section.library)
      if (!allowed.includes(nextMode)) {
        var whyV = section.library.visibility === 'private'
          ? 'المكتبة نفسها خاصة — كل ما داخلها يبقى خاصاً ولا يمكن جعل قسم فيها عاماً أو برابط (منع للتسريب)'
          : 'المكتبة تُفتح لمن يمتلك رابطها فقط — القسم فيها يكون خاصاً أو برابط وصول، ولا يمكن جعله عاماً'
        return NextResponse.json({ error: 'visibility_conflict', message: whyV }, { status: 403 })
      }
    }

    const result = await safeDbOp(
      () => db.librarySection.update({ where: { id }, data, select: { id: true, name: true, isPrivate: true, linkToken: true } }),
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
    // v101: الخاص الفعلي يُدار بصاحبي القسم/المكتبة حصراً — الإدارة مستثناة
    if (!canManageSection(user, section.ownerId, section.library.ownerId, effectiveSectionMode(section.library, section))) {
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
