import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const where: any = {}
    if (projectId) where.projectId = projectId

    const result = await safeDbOp(
      () => db.driveLine.findMany({
        where,
        include: { project: { select: { id: true, name: true, code: true, pricePerMeter: true } } },
        orderBy: [{ projectId: 'asc' }, { lineNumber: 'asc' }],
        take: 200,
      }), 'جلب خطوط الحفر'
    )
    if (!result.success) return result.response

    var driveLines = result.data

    // Dynamic progress: calculate from MAX endReading of daily reports (single query)
    if (driveLines.length > 0) {
      try {
        var dlIds: string[] = driveLines.map(function(dl: any) { return dl.id })
        var maxReadings = await (db.dailyReport.groupBy as any)({
          by: ['driveLineId'],
          where: { driveLineId: { in: dlIds } },
          _max: { endReading: true },
        })
        // Build map: driveLineId -> maxEndReading
        var readingMap: Record<string, number> = {}
        for (var i = 0; i < maxReadings.length; i++) {
          var dlKey = String(maxReadings[i].driveLineId || '')
          readingMap[dlKey] = maxReadings[i]._max.endReading || 0
        }
        // Apply to each drive line
        for (var j = 0; j < driveLines.length; j++) {
          var dl = driveLines[j]
          var completedLength = readingMap[dl.id] || 0
          var progress = dl.totalLength > 0 ? (completedLength / dl.totalLength) * 100 : 0
          dl.completedLength = completedLength
          dl.progress = Math.min(progress, 100)
          dl.status = progress >= 100 ? 'completed' : (completedLength > 0 ? 'in_progress' : dl.status)
        }
      } catch (e) {
        // Keep stored values if dynamic calc fails
      }
    }

    return NextResponse.json({ driveLines: driveLines })
  } catch (error: any) {
    return handleDbError(error, 'جلب خطوط الحفر')
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    if (!canWrite(user.role, 'drive_lines', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإنشاء خطوط حفر' }, { status: 403 })
    }

    const body = await req.json()
    const validationError = validateRequired(body, ['projectId', 'lineNumber', 'startPoint', 'endPoint', 'totalLength', 'diameter', 'pipeType', 'soilType'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.driveLine.create({
        data: {
          projectId: String(body.projectId), lineNumber: String(body.lineNumber).trim(),
          startPoint: String(body.startPoint).trim(), endPoint: String(body.endPoint).trim(),
          totalLength: parseNumber(body.totalLength, 0), diameter: String(body.diameter),
          pipeType: String(body.pipeType), soilType: String(body.soilType),
          depth: parseNumber(body.depth, 0), status: String(body.status || 'not_started'),
          completedLength: 0, progress: 0, problems: body.problems ? String(body.problems) : null,
        },
      }), 'إنشاء خط الحفر'
    )
    if (!createResult.success) return createResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({
        data: {
          userId: user.id, projectId: String(body.projectId),
          action: 'create', entity: 'drive_line', entityId: createResult.data.id,
          details: 'إنشاء خط حفر: ' + String(body.lineNumber).trim() + ' (' + String(body.startPoint).trim() + ' → ' + String(body.endPoint).trim() + ')',
        },
      }), 'سجل التدقيق'),
    ]).catch(function() {})

    return NextResponse.json({ driveLine: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء خط الحفر')
  }
}
