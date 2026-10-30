// ─── v97: المكتبات — قائمة المكتبات وإنشاء مكتبة جديدة ─────────────────────
// GET  /api/libraries  → كل المكتبات مع أقسامها المرئية للمستخدم الحالي
//                        (القسم الخاص يظهر لصاحبه ومدير النظام فقط)
// POST /api/libraries  → إنشاء مكتبة — لكل موظف يملك صلاحية القسم (بقرار صاحب
//                        الموقع القسم عام لكل الموظفين)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canWrite } from '@/lib/auth'
import { ensureLibrariesSupport } from '@/lib/db-selfheal'
import { filterVisibleSections, isLibraryAdmin } from '@/lib/libraries'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // بوابة القسم: نفس صلاحية «المكتبات» في إدارة المستخدمين (ومدير النظام يتجاوز)
    if (!hasPermission(user.role, 'libraries', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الوصول' }, { status: 403 })
    }

    // v97: تجهيز جداول المكتبات تلقائياً عند أول استخدام (idempotent — بلا أي أثر إن وُجدت)
    await ensureLibrariesSupport()

    var rows = await db.library.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        ownerId: true,
        createdAt: true,
        owner: { select: { id: true, name: true, nameEn: true } },
        sections: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            name: true,
            isPrivate: true,
            linkToken: true,
            ownerId: true,
            createdAt: true,
            owner: { select: { id: true, name: true, nameEn: true } },
            _count: { select: { files: true } },
          },
        },
      },
    })

    // الرؤية تُطبَّق هنا خادمياً: الخاص و«برابط» لا يُرسلان أصلاً لغير أهلها
    // (v98: الفلترة تعرف صاحب المكتبة — أقسام «برابط» تُخفى عن القوائم كالخاص)
    var admin = isLibraryAdmin(user)
    var libraries = rows.map((lib) => {
      var visible = admin ? lib.sections : filterVisibleSections(user, lib.sections, lib.ownerId)
      var fileCount = visible.reduce((acc, s) => acc + s._count.files, 0)
      return {
        id: lib.id,
        name: lib.name,
        description: lib.description,
        createdAt: lib.createdAt,
        ownerId: lib.ownerId,
        owner: lib.owner,
        isMine: lib.ownerId === user.id,
        canManage: lib.ownerId === user.id || admin,
        sectionCount: visible.length,
        fileCount,
        sections: visible.map((s) => ({
          id: s.id,
          name: s.name,
          isPrivate: s.isPrivate,
          createdAt: s.createdAt,
          ownerId: s.ownerId,
          owner: s.owner,
          fileCount: s._count.files,
          // v98: توكن «رابط الوصول» يُسلَّم لمدرّ القسم فقط (صاحبه/صاحب المكتبة/
          // مدير النظام) — أقسام البرابط لا تصل أصلاً لغيرهم فلا تسريب ممكن
          linkToken: (admin || s.ownerId === user.id || lib.ownerId === user.id) ? s.linkToken : undefined,
        })),
      }
    })

    return NextResponse.json({ libraries })
  } catch (error: any) {
    return handleDbError(error, 'تحميل المكتبات')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // كل موظف يملك صلاحية القسم يستطيع إنشاء مكتبة (ومدير النظام يتجاوز دائماً)
    if (!canWrite(user.role, 'libraries', user.permissions) && !isLibraryAdmin(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية إنشاء المكتبات' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    await ensureLibrariesSupport()

    const body = await req.json()
    const validationError = validateRequired(body, ['name'])
    if (validationError) return validationError

    var name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة مطلوب' }, { status: 400 })
    if (name.length > 120) return NextResponse.json({ error: 'invalid_name', message: 'اسم المكتبة طويل جداً (الحد 120 حرفاً)' }, { status: 400 })
    var description = body.description != null ? String(body.description).trim().slice(0, 500) : null

    // سقف وقائي من التضخم: 50 مكتبة لكل موظف (مكتبات شخصية لا تتجاوز ذلك عملياً)
    var mine = await db.library.count({ where: { ownerId: user.id } })
    if (mine >= 50) {
      return NextResponse.json({ error: 'too_many', message: 'بلغت الحد الأقصى (50 مكتبة) — احذف مكتبة لا تحتاجها أو تواصل الإدارة' }, { status: 400 })
    }

    const result = await safeDbOp(
      () => db.library.create({
        data: { name, description, ownerId: user.id },
        select: {
          id: true, name: true, description: true, ownerId: true, createdAt: true,
          owner: { select: { id: true, name: true, nameEn: true } },
        },
      }),
      'إنشاء مكتبة'
    )
    if (!result.success) return result.response

    return NextResponse.json({ library: { ...result.data, isMine: true, canManage: true, sectionCount: 0, fileCount: 0, sections: [] }, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء مكتبة')
  }
}
