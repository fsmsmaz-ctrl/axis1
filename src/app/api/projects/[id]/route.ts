import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, handleDbError, validateRequired, parseNumber, parseDate, buildAuditDetails } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    }

    const { id } = await params

    const result = await safeDbOp(
      () => db.project.findUnique({
        where: { id },
        include: {
          manager: { select: { id: true, name: true, nameEn: true } },
          engineer: { select: { id: true, name: true, nameEn: true } },
          driveLines: { orderBy: { lineNumber: 'asc' } },
          equipments: true,
          _count: { select: { dailyReports: true, costs: true, finishings: true } },
        },
      }),
      'جلب المشروع'
    )
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'المشروع غير موجود' }, { status: 404 })

    var project = result.data

    const aggResult = await safeDbOp(
      () => db.dailyReport.aggregate({
        where: { projectId: id, status: 'approved' },
        _sum: { dailyMeters: true, dailyRevenue: true },
      }),
      'إحصائيات المشروع'
    )

    const costAggResult = await safeDbOp(
      () => db.cost.aggregate({ where: { projectId: id }, _sum: { amount: true } }),
      'إجمالي التكاليف'
    )

    const totalMeters = aggResult.success ? (aggResult.data._sum.dailyMeters || 0) : 0
    const totalRevenue = aggResult.success ? (aggResult.data._sum.dailyRevenue || 0) : 0
    const totalCost = costAggResult.success ? (costAggResult.data._sum.amount || 0) : 0

    return NextResponse.json({
      project: { ...project, totalMetersDrilled: totalMeters, totalRevenue, totalCost, netProfit: totalRevenue - totalCost },
    })
  } catch (error) {
    return handleDbError(error, 'جلب المشروع')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    }

    // FIX: Use centralized RBAC
    if (!canWrite(user.role, 'projects', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل المشاريع' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()

    // FIX: Validate required fields
    const validationError = validateRequired(body, ['code', 'name', 'client', 'location', 'workType', 'pipeDiameter', 'soilType'])
    if (validationError) return validationError

    // FIX: Get old data for audit diff
    const oldResult = await safeDbOp(
      () => db.project.findUnique({ where: { id }, select: { code: true, name: true, client: true, location: true, workType: true, pipeDiameter: true, totalLength: true, pricePerMeter: true, soilType: true, startDate: true, expectedEnd: true, status: true, notes: true } }),
      'البحث عن المشروع'
    )
    if (!oldResult.success) return oldResult.response
    if (!oldResult.data) return NextResponse.json({ error: 'not_found', message: 'المشروع غير موجود' }, { status: 404 })

    var totalLength = parseNumber(body.totalLength, 0)
    var pricePerMeter = parseNumber(body.pricePerMeter, 0)
    var startDate = body.startDate ? new Date(body.startDate) : oldResult.data.startDate
    var expectedEnd = body.expectedEnd ? new Date(body.expectedEnd) : oldResult.data.expectedEnd

    // FIX: Validate dates
    if (isNaN(startDate.getTime())) {
      return NextResponse.json({ error: 'invalid_date', message: 'تاريخ البدء غير صحيح' }, { status: 400 })
    }
    if (isNaN(expectedEnd.getTime())) {
      return NextResponse.json({ error: 'invalid_date', message: 'التاريخ المتوقع غير صحيح' }, { status: 400 })
    }

    var updateData: Record<string, any> = {
      code: String(body.code).trim(),
      name: String(body.name).trim(),
      client: String(body.client).trim(),
      location: String(body.location).trim(),
      contractNumber: body.contractNumber ? String(body.contractNumber).trim() : null,
      workType: String(body.workType),
      pipeDiameter: String(body.pipeDiameter),
      totalLength,
      pricePerMeter,
      soilType: String(body.soilType),
      startDate,
      expectedEnd,
      status: String(body.status || oldResult.data.status),
      notes: body.notes ? String(body.notes) : null,
    }

    const updateResult = await safeDbOp(
      () => db.project.update({ where: { id }, data: updateData }),
      'تحديث المشروع'
    )
    if (!updateResult.success) return updateResult.response

    // FIX: Use buildAuditDetails for proper change tracking
    var newData = { ...updateData, totalLength, pricePerMeter }
    var details = buildAuditDetails(
      oldResult.data as Record<string, any>,
      newData,
      'Updated project ' + updateResult.data.code
    )

    safeDbOp(
      () => db.auditLog.create({
        data: { userId: user.id, projectId: id, action: 'update', entity: 'project', entityId: id, details },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    return NextResponse.json({ project: updateResult.data })
  } catch (error) {
    return handleDbError(error, 'تحديث المشروع')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    }

    if (user.role !== 'top_management') {
      return NextResponse.json({ error: 'forbidden', message: 'حذف المشاريع متاح فقط للإدارة العليا' }, { status: 403 })
    }

    const { id } = await params

    // FIX: Check project exists first
    const existingResult = await safeDbOp(
      () => db.project.findUnique({ where: { id }, select: { id: true, code: true, status: true, _count: { select: { dailyReports: true, costs: true, driveLines: true, finishings: true } } } }),
      'البحث عن المشروع'
    )
    if (!existingResult.success) return existingResult.response
    if (!existingResult.data) return NextResponse.json({ error: 'not_found', message: 'المشروع غير موجود' }, { status: 404 })

    var project = existingResult.data
    var counts = project._count

    // FIX: Warn if project has data — but still allow top_management to delete
    var hasData = counts.dailyReports > 0 || counts.costs > 0 || counts.driveLines > 0 || counts.finishings > 0

    var deleteResult = await safeDbOp(() => db.project.delete({ where: { id } }), 'حذف المشروع')
    if (!deleteResult.success) return deleteResult.response

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id, action: 'delete', entity: 'project', entityId: id,
          details: 'Deleted project ' + project.code + ' (had ' + counts.dailyReports + ' reports, ' + counts.costs + ' costs)',
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // FIX-4.4: Fixed missing closing brace — was causing TypeScript build error
    return NextResponse.json({ success: true, hadData })
  } catch (error) {
    return handleDbError(error, 'حذف المشروع')
  }
}
