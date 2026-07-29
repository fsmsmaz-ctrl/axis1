import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, buildAuditDetails, handleDbError } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  var { id } = await params

  var project = await db.project.findUnique({
    where: { id },
    include: {
      manager: { select: { id: true, name: true, nameEn: true } },
      engineer: { select: { id: true, name: true, nameEn: true } },
      driveLines: { orderBy: { lineNumber: 'asc' } },
      equipments: true,
      _count: { select: { dailyReports: true, costs: true, finishings: true } },
    },
  })

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  var reports = await db.dailyReport.findMany({
    where: { projectId: id, status: 'approved' },
    select: { dailyMeters: true, dailyRevenue: true, reportDate: true },
  })

  var totalMeters = reports.reduce(function(s: number, r: any) { return s + r.dailyMeters }, 0)
  var totalRevenue = reports.reduce(function(s: number, r: any) { return s + r.dailyRevenue }, 0)

  var costsAgg = await db.cost.aggregate({
    where: { projectId: id },
    _sum: { amount: true },
  })

  var totalCost = costsAgg._sum.amount || 0

  return NextResponse.json({
    project: {
      ...project,
      totalMetersDrilled: totalMeters,
      totalRevenue,
      totalCost,
      netProfit: totalRevenue - totalCost,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
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
  var body = await req.json()

  try {
    // Fetch old data before update
    var oldProject = await db.project.findUnique({ where: { id } })

    var project = await db.project.update({
      where: { id },
      data: {
        code: body.code,
        name: body.name,
        client: body.client,
        location: body.location,
        contractNumber: body.contractNumber,
        workType: body.workType,
        pipeDiameter: body.pipeDiameter,
        totalLength: parseFloat(body.totalLength),
        pricePerMeter: parseFloat(body.pricePerMeter),
        soilType: body.soilType,
        startDate: new Date(body.startDate),
        expectedEnd: new Date(body.expectedEnd),
        status: body.status,
        notes: body.notes,
      },
    })

    // Build detailed changes diff
    var details = oldProject
      ? buildAuditDetails(oldProject, body, 'تعديل المشروع: ' + project.code)
      : 'تعديل المشروع: ' + project.code

    // Audit log
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: id, action: 'update', entity: 'project', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
    ]).catch(function() {})

    return NextResponse.json({ project })
  } catch (error) {
    console.error('Update project error:', error)
    return handleDbError(error, 'تحديث المشروع')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
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
    await db.project.delete({ where: { id } })

    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, action: 'delete', entity: 'project', entityId: id, details: 'Deleted project' },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: { type: 'work_stopped', title: 'حذف مشروع', message: 'تم حذف مشروع (المعرف: ' + id + ') بواسطة ' + user.name, severity: 'critical' },
        }),
        'إشعار الحذف'
      ),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete project error:', error)
    return handleDbError(error, 'حذف المشروع')
  }
}
