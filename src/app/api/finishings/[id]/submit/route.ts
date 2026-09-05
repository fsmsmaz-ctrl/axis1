import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { notifyUsers } from '@/lib/notify'

// رفع التشطيب للإدارة: من مسودة إلى مرفوعة للاعتماد — بعد الانتهاء من العمل
// متاح للمشرف (foreman) ومدير النظام فقط، ويشترط اكتمال بنود التشطيب الخمسة
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var existingResult = await safeDbOp(
      () => db.finishing.findUnique({
        where: { id },
        select: {
          status: true, projectId: true, date: true,
          siteCleaned: true, wasteRemoved: true, shaftClosed: true, siteRestored: true, lineHandover: true, casingSpacer: true,
          project: { select: { name: true, code: true } },
        },
      }),
      'البحث عن التشطيب'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data

    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'التشطيب غير موجود' }, { status: 404 })
    }

    if (existing.status === 'submitted') {
      return NextResponse.json({ error: 'invalid_status', message: 'التشطيب مرفوع للإدارة مسبقاً وهو بانتظار الاعتماد' }, { status: 400 })
    }
    if (existing.status === 'approved') {
      return NextResponse.json({ error: 'invalid_status', message: 'التشطيب معتمد مسبقاً ولا يمكن رفعه مجدداً' }, { status: 400 })
    }
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      return NextResponse.json({ error: 'invalid_status', message: 'لا يمكن رفع التشطيب بحالته الحالية' }, { status: 400 })
    }

    // الرفع: المشرف (foreman) أو مدير النظام فقط — مثل دورة التقارير اليومية
    var isSupervisor = user!.role === 'foreman'
    var isSystemAdmin = (user!.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    if (!isSupervisor && !isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'رفع التشطيب للإدارة متاح للمشرف (الفورمان) ومدير النظام فقط' }, { status: 403 })
    }

    // شرط الانتهاء من العمل: اكتمال بنود التشطيب الخمسة جميعها
    var missingItems: string[] = []
    if (!existing.siteCleaned) missingItems.push('تنظيف الموقع')
    if (!existing.wasteRemoved) missingItems.push('إزالة النفايات')
    if (!existing.shaftClosed) missingItems.push('إغلاق الحفر')
    if (!existing.siteRestored) missingItems.push('إعادة الوضع كما كان')
    if (!existing.lineHandover) missingItems.push('تسليم الخط')
    if (!existing.casingSpacer) missingItems.push('حشوة الكيسنج (سبيسر)')
    if (missingItems.length > 0) {
      return NextResponse.json(
        { error: 'incomplete_work', message: 'لا يمكن الرفع قبل الانتهاء من العمل — بنود ناقصة: ' + missingItems.join('، ') },
        { status: 400 }
      )
    }

    var updateResult = await safeDbOp(
      () => db.finishing.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedById: user!.id,
          submittedAt: new Date(),
        },
      }),
      'رفع التشطيب للإدارة'
    )
    if (!updateResult.success) return updateResult.response

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id, projectId: existing.projectId,
          action: 'submit', entity: 'finishing', entityId: id,
          details: 'Submitted finishing to management for approval',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // ── تنبيه أصحاب صلاحية الاعتماد: تشطيب مرفوع بانتظار القرار ──
    // يصل للإدارة العليا ومديري المشاريع ومدير النظام (باستثناء الرافع نفسه)
    notifyUsers({
      type: 'finishing_pending_approval',
      title: 'تشطيب مرفوع بانتظار اعتماد الإدارة',
      message: 'تم رفع تشطيب بتاريخ ' + new Date(existing.date).toISOString().split('T')[0] + ' بواسطة ' + user!.name + ' — مشروع ' + (existing.project?.name || existing.project?.code || '') + ' وهو بانتظار الاعتماد أو الرفض.',
      severity: 'info',
      projectId: existing.projectId,
      link: 'finishings',
      entityType: 'finishing',
      entityId: id + ':pending',
      permissions: ['finishings'],
      roles: ['top_management', 'project_manager'],
      includeSystemAdmin: true,
      excludeUserIds: [user!.id],
    }).catch(function() {})

    return NextResponse.json({ finishing: updateResult.data, success: true })
  } catch (error) {
    return handleDbError(error, 'رفع التشطيب للإدارة')
  }
}

