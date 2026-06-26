import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  const limit = parseInt(searchParams.get('limit') || '50')

  const where: any = {}
  if (projectId) where.projectId = projectId

  const result = await safeDbOp(
    () => db.dailyReport.findMany({
      where,
      take: limit,
      orderBy: { reportDate: 'desc' },
      include: {
        project: { select: { id: true, name: true, code: true, pricePerMeter: true } },
        driveLine: { select: { id: true, lineNumber: true, totalLength: true } },
        safety: true,
        createdBy: { select: { name: true, nameEn: true } },
        approver: { select: { name: true, nameEn: true } },
      },
    }),
    'جلب التقارير اليومية'
  )

  if (!result.success) return result.response
  return NextResponse.json({ reports: result.data })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['projectId', 'reportDate'])
    if (validationError) return validationError

    // Calculate production data
    const startReading = parseNumber(body.startReading, 0)
    const endReading = parseNumber(body.endReading, 0)
    const dailyMeters = Math.max(0, endReading - startReading)

    // Get drive line for totalLength calculation
    let totalLength = 0
    if (body.driveLineId) {
      const dlResult = await safeDbOp(
        () => db.driveLine.findUnique({ where: { id: body.driveLineId } }),
        'جلب خط الحفر'
      )
      if (dlResult.success && dlResult.data) {
        totalLength = dlResult.data.totalLength
      }
    }

    const totalMeters = endReading
    const remainingMeters = Math.max(0, totalLength - totalMeters)
    const progressPercent = totalLength > 0 ? (totalMeters / totalLength) * 100 : 0

    // Get project price per meter
    const projResult = await safeDbOp(
      () => db.project.findUnique({ where: { id: body.projectId }, select: { pricePerMeter: true } }),
      'جلب بيانات المشروع'
    )
    const pricePerMeter = projResult.success && projResult.data ? projResult.data.pricePerMeter : 0
    const dailyRevenue = dailyMeters * pricePerMeter

    const createResult = await safeDbOp(
      () => db.dailyReport.create({
        data: {
          projectId: String(body.projectId),
          driveLineId: body.driveLineId || null,
          reportDate: new Date(body.reportDate),
          weather: body.weather || null,
          workStartTime: body.workStartTime || null,
          workEndTime: body.workEndTime || null,
          operatingHours: parseNumber(body.operatingHours, 0),
          stoppageHours: parseNumber(body.stoppageHours, 0),
          stoppageReason: body.stoppageReason || null,
          workersCount: parseInt(body.workersCount) || 0,
          attendees: body.attendees || null,
          startReading,
          endReading,
          dailyMeters,
          totalMeters,
          remainingMeters,
          progressPercent,
          soilExcavated: body.soilExcavated || null,
          pipesInstalled: parseInt(body.pipesInstalled) || 0,
          productionNotes: body.productionNotes || null,
          problems: body.problems || null,
          dailyRevenue,
          status: body.status || 'draft',
          createdById: user.id,
        },
      }),
      'إنشاء التقرير اليومي'
    )
    if (!createResult.success) return createResult.response

    // Update drive line progress (non-critical)
    if (body.driveLineId) {
      await safeDbOp(
        () => db.driveLine.update({
          where: { id: body.driveLineId },
          data: {
            completedLength: totalMeters,
            progress: progressPercent,
            status: progressPercent >= 100 ? 'completed' : 'in_progress',
          },
        }),
        'تحديث تقدم خط الحفر'
      )
    }

    // Update project progress (non-critical)
    if (projResult.success && projResult.data) {
      const allLinesResult = await safeDbOp(
        () => db.driveLine.findMany({
          where: { projectId: body.projectId },
          select: { totalLength: true, completedLength: true },
        }),
        'جلب جميع خطوط الحفر'
      )
      if (allLinesResult.success) {
        const totalAll = allLinesResult.data.reduce((s, l) => s + l.totalLength, 0)
        const completedAll = allLinesResult.data.reduce((s, l) => s + l.completedLength, 0)
        const projectProgress = totalAll > 0 ? (completedAll / totalAll) * 100 : 0

        await safeDbOp(
          () => db.project.update({
            where: { id: body.projectId },
            data: { progress: projectProgress },
          }),
          'تحديث تقدم المشروع'
        )
      }
    }

    // Audit log (non-critical)
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId,
          dailyReportId: createResult.data.id,
          action: 'create',
          entity: 'daily_report',
          entityId: createResult.data.id,
          details: `Created daily report for ${body.reportDate}`,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ report: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التقرير اليومي')
  }
}
