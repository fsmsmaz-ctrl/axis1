import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { notifyUsers } from '@/lib/notify'

// تسليم التقرير: من مسودة إلى مرسل — بعد الانتهاء من تعديل البيانات
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
      () => db.dailyReport.findUnique({
        where: { id },
        select: {
          status: true, projectId: true, reportDate: true, createdById: true,
          // v30: حقول حاجز اكتمال البيانات قبل التسليم
          driveLineId: true, workStartTime: true, workEndTime: true,
          operatingHours: true, stoppageHours: true, stoppageReason: true,
          workersCount: true, startReading: true, endReading: true,
          project: { select: { name: true, code: true } },
        },
      }),
      'البحث عن التقرير'
    )
    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    if (existingReport.status !== 'draft') {
      return NextResponse.json({ error: 'invalid_status', message: 'التقرير مسلّم مسبقاً' }, { status: 400 })
    }

    // v30: حاجز الاكتمال — لا يمكن تسليم التقرير وإرساله للاعتماد إلا بعد إدخال كل البيانات
    var missingFields: string[] = []
    if (!existingReport.driveLineId) missingFields.push('خط الحفر')
    if (!existingReport.workStartTime) missingFields.push('بداية العمل')
    if (!existingReport.workEndTime) missingFields.push('نهاية العمل')
    if ((existingReport.operatingHours || 0) <= 0 && (existingReport.stoppageHours || 0) <= 0) missingFields.push('ساعات التشغيل')
    if ((existingReport.workersCount || 0) <= 0) missingFields.push('عدد العمال')
    if ((existingReport.endReading || 0) <= 0 && (existingReport.startReading || 0) <= 0) missingFields.push('قراءتا البداية والنهاية (م)')
    if ((existingReport.endReading || 0) < (existingReport.startReading || 0)) missingFields.push('قراءة النهاية أقل من قراءة البداية')
    if ((existingReport.stoppageHours || 0) > 0 && !(existingReport.stoppageReason || '').trim()) missingFields.push('سبب التوقف')
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: 'incomplete_report', message: 'لا يمكن تسليم التقرير — بيانات ناقصة: ' + missingFields.join('، ') },
        { status: 400 }
      )
    }

    // v23: التسليم متاح لأي موظف مصرّح له — لأي مسودة (ولو أنشأها موظف آخر)
    var isSystemAdmin = (user!.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
    var canSubmitReport = canWrite(user!.role, 'daily_reports', user!.permissions) || canWrite(user!.role, 'safety', user!.permissions)
    if (!isSystemAdmin && !canSubmitReport) {
      return NextResponse.json({ error: 'forbidden', message: 'تسليم التقارير اليومية متاح للموظفين المصرّح لهم فقط' }, { status: 403 })
    }

    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: { status: 'submitted' },
      }),
      'تسليم التقرير'
    )
    if (!updateResult.success) return updateResult.response

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id, dailyReportId: id, projectId: existingReport.projectId,
          action: 'submit', entity: 'daily_report', entityId: id,
          details: 'Submitted daily report for approval',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // ── تنبيه أصحاب صلاحية الاعتماد: تقرير بحاجة إلى اعتماد ──
    // يصل للإدارة العليا ومديري المشاريع ومدير النظام (باستثناء المُسلّم نفسه)
    notifyUsers({
      type: 'report_pending_approval',
      title: 'تقرير يومي بحاجة إلى اعتماد',
      message: 'تم تسليم تقرير يومي بتاريخ ' + new Date(existingReport.reportDate).toISOString().split('T')[0] + ' بواسطة ' + user!.name + ' — مشروع ' + (existingReport.project?.name || existingReport.project?.code || '') + ' وهو بانتظار الاعتماد.',
      severity: 'info',
      projectId: existingReport.projectId,
      link: 'dailyReports',
      entityType: 'daily_report',
      entityId: id + ':pending',
      permissions: ['daily_reports'],
      roles: ['top_management', 'project_manager'],
      includeSystemAdmin: true,
      excludeUserIds: [user!.id],
    }).catch(function() {})

    return NextResponse.json({ report: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'تسليم التقرير')
  }
}

