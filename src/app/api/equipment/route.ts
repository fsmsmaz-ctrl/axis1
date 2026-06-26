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

  const where: any = {}
  if (projectId) where.projectId = projectId

  const result = await safeDbOp(
    () => db.equipment.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, code: true } },
        maintenance: { orderBy: { date: 'desc' }, take: 5 },
      },
      orderBy: { name: 'asc' },
    }),
    'جلب المعدات'
  )

  if (!result.success) return result.response
  return NextResponse.json({ equipment: result.data })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['name', 'number', 'type'])
    if (validationError) return validationError

    // Check for duplicate number
    const dupResult = await safeDbOp(
      () => db.equipment.findUnique({ where: { number: String(body.number).trim() } }),
      'فحص الرمز المكرر'
    )
    if (dupResult.success && dupResult.data) {
      return NextResponse.json({
        error: 'duplicate_number',
        message: `المعدة برقم "${body.number}" موجودة بالفعل`,
      }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.equipment.create({
        data: {
          projectId: body.projectId || null,
          name: String(body.name).trim(),
          number: String(body.number).trim(),
          type: String(body.type),
          status: String(body.status || 'operational'),
          dailyHours: parseNumber(body.dailyHours, 0),
          lastMaintenance: body.lastMaintenance ? new Date(body.lastMaintenance) : null,
          nextMaintenance: body.nextMaintenance ? new Date(body.nextMaintenance) : null,
          notes: body.notes ? String(body.notes) : null,
        },
      }),
      'إنشاء المعدة'
    )
    if (!createResult.success) return createResult.response

    // Audit log (non-critical)
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId,
          action: 'create',
          entity: 'equipment',
          entityId: createResult.data.id,
          details: `Created equipment ${createResult.data.number}`,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ equipment: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المعدة')
  }
}
