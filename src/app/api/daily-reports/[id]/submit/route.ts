import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'

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
        select: { status: true, projectId: true, createdById: true },
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

    // نفس صلاحية تعديل المسودات: صاحب التقرير أو (الإدارة العليا/مدير المشروع/مهندس الموقع)
    var canEditAny = user!.role === 'top_management' || user!.role === 'project_manager' || user!.role === 'site_engineer'
    if (!canEditAny && existingReport.createdById !== user!.id) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تسليم تقرير موظف آخر' }, { status: 403 })
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

    return NextResponse.json({ report: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'تسليم التقرير')
  }
}
