import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // FIX: Use role-based check for consistency
  if (user.role !== 'project_manager' && user.role !== 'top_management') {
    return NextResponse.json({ error: 'forbidden', message: 'اعتماد التقارير متاح فقط لمدير المشاريع أو الإدارة العليا' }, { status: 403 })
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
        include: { project: { select: { pricePerMeter: true } } },
      }),
      'البحث عن التقرير'
    )
    if (!existingResult.success) return existingResult.response
    var existingReport = existingResult.data

    if (!existingReport) {
      return NextResponse.json({ error: 'not_found', message: 'التقرير غير موجود' }, { status: 404 })
    }

    if (existingReport.status !== 'submitted') {
      return NextResponse.json(
        { error: 'invalid_status', message: 'لا يمكن اعتماد تقرير لم يتم تسليمه' },
        { status: 400 }
      )
    }

    var pricePerMeter = existingReport.project?.pricePerMeter || 0
    var dailyMeters = Math.max(0, (existingReport.endReading || 0) - (existingReport.startReading || 0))
    var dailyRevenue = dailyMeters * pricePerMeter

    var updateResult = await safeDbOp(
      () => db.dailyReport.update({
        where: { id },
        data: {
          status: 'approved',
          approvedById: user!.id,
          approvedAt: new Date(),
          dailyRevenue: dailyRevenue,
        },
      }),
      'اعتماد التقرير'
    )
    if (!updateResult.success) return updateResult.response

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id, dailyReportId: id, projectId: existingReport.projectId,
          action: 'approve', entity: 'daily_report', entityId: id,
          details: 'Approved daily report (revenue: ' + dailyRevenue + ' OMR)',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    return NextResponse.json({ report: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'اعتماد التقرير')
  }
}

