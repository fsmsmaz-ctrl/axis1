import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'

// GET drive lines, optionally filtered by projectId
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')

  const where: any = {}
  if (projectId) where.projectId = projectId

  const result = await safeDbOp(
    () => db.driveLine.findMany({
      where,
      include: { project: { select: { id: true, name: true, code: true } } },
      orderBy: [{ projectId: 'asc' }, { lineNumber: 'asc' }],
    }),
    'جلب خطوط الحفر'
  )

  if (!result.success) return result.response
  return NextResponse.json({ driveLines: result.data })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, [
      'projectId', 'lineNumber', 'startPoint', 'endPoint', 'totalLength', 'diameter', 'pipeType', 'soilType'
    ])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.driveLine.create({
        data: {
          projectId: String(body.projectId),
          lineNumber: String(body.lineNumber).trim(),
          startPoint: String(body.startPoint).trim(),
          endPoint: String(body.endPoint).trim(),
          totalLength: parseNumber(body.totalLength, 0),
          diameter: String(body.diameter),
          pipeType: String(body.pipeType),
          soilType: String(body.soilType),
          depth: parseNumber(body.depth, 0),
          status: String(body.status || 'not_started'),
          completedLength: 0,
          progress: 0,
          problems: body.problems ? String(body.problems) : null,
        },
      }),
      'إنشاء خط الحفر'
    )
    if (!createResult.success) return createResult.response

    // Audit log (non-critical)
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId,
          action: 'create',
          entity: 'drive_line',
          entityId: createResult.data.id,
          details: `Created drive line ${createResult.data.lineNumber}`,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ driveLine: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء خط الحفر')
  }
}
