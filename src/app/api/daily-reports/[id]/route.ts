import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var { id } = await params

  var report = await db.dailyReport.findUnique({
    where: { id },
    include: {
      project: true,
      driveLine: true,
      safety: true,
      costs: true,
      attachments: true,
      createdBy: { select: { name: true, nameEn: true } },
      approver: { select: { name: true, nameEn: true } },
    },
  })

  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  return NextResponse.json({ report })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  // Fetch the report first to verify ownership and status
  var existingReport = await db.dailyReport.findUnique({
    where: { id },
    select: { createdById: true, status: true, projectId: true },
  })

  if (!existingReport) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // Only allow editing own reports (or admin/manager can edit any)
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    if (existingReport.createdById !== user.id) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل تقرير آخر موظف' }, { status: 403 })
    }
  }

  // Only draft reports can be edited
  if (existingReport.status !== 'draft') {
    return NextResponse.json({ error: 'forbidden', message: 'لا يمكن تعديل تقرير تم تسليمه أو اعتماده' }, { status: 403 })
  }

  var body = await req.json()

  try {
    var startReading = parseFloat(body.startReading) || 0
    var endReading = parseFloat(body.endReading) || 0
    var dailyMeters = Math.max(0, endReading - startReading)

    var driveLine = body.driveLineId
      ? await db.driveLine.findUnique({ where: { id: body.driveLineId } })
      : null

    var totalLength = driveLine?.totalLength || 0
    var totalMeters = endReading
    var remainingMeters = Math.max(0, totalLength - totalMeters)
    var progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    var project = await db.project.findUnique({
      where: { id: existingReport.projectId },
      select: { pricePerMeter: true },
    })

    var dailyRevenue = dailyMeters * (project?.pricePerMeter || 0)

    var report = await db.dailyReport.update({
      where: { id },
      data: {
        projectId: existingReport.projectId,
        driveLineId: body.driveLineId || null,
        reportDate: new Date(body.reportDate),
        weather: body.weather,
        workStartTime: body.workStartTime,
        workEndTime: body.workEndTime,
        operatingHours: parseFloat(body.operatingHours) || 0,
        stoppageHours: parseFloat(body.stoppageHours) || 0,
        stoppageReason: body.stoppageReason,
        workersCount: parseInt(body.workersCount) || 0,
        attendees: body.attendees,
        startReading,
        endReading,
        dailyMeters,
        totalMeters,
        remainingMeters,
        progressPercent,
        soilExcavated: body.soilExcavated,
        pipesInstalled: parseInt(body.pipesInstalled) || 0,
        productionNotes: body.productionNotes,
        problems: body.problems,
        dailyRevenue,
        status: body.status || 'draft',
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        projectId: existingReport.projectId,
        dailyReportId: id,
        action: 'update',
        entity: 'daily_report',
        entityId: id,
        details: 'Updated daily report',
      },
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('Update daily report error:', error)
    return handleDbError(error, 'تحديث التقرير اليومي')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    // Get report details before deleting
    var report = await db.dailyReport.findUnique({
      where: { id },
      select: { projectId: true, status: true, createdById: true },
    })

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Only top management can delete approved reports
    if (report.status === 'approved' && user.role !== 'top_management') {
      return NextResponse.json({ error: 'Cannot delete approved report' }, { status: 403 })
    }

    // Only allow deleting own draft/submitted reports (or admin/manager can delete any non-approved)
    if (user.role !== 'top_management' && user.role !== 'project_manager') {
      if (report.createdById !== user.id) {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك حذف تقرير آخر موظف' }, { status: 403 })
      }
    }

    await db.dailyReport.delete({ where: { id } })

    // Audit log + delete notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: report.projectId,
            dailyReportId: id,
            action: 'delete',
            entity: 'daily_report',
            entityId: id,
            details: 'Deleted daily report',
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: report.projectId,
            type: 'report_delay',
            title: 'حذف تقرير يومي',
            message: 'تم حذف تقرير يومي (المعرف: ' + id + ') بواسطة ' + user.name,
            severity: 'warning',
          },
        }),
        'إشعار الحذف'
      ),
    ]).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete report error:', error)
    return handleDbError(error, 'حذف التقرير اليومي')
  }
}
