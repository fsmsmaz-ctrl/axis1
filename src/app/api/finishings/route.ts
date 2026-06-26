import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'

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
    () => db.finishing.findMany({
      where,
      include: {
        project: { select: { id: true, name: true, code: true } },
        signedByUser: { select: { name: true, nameEn: true } },
      },
      orderBy: { date: 'desc' },
    }),
    'جلب التشطيبات'
  )

  if (!result.success) return result.response
  return NextResponse.json({ finishings: result.data })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  try {
    const body = await req.json()

    const validationError = validateRequired(body, ['projectId', 'date'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.finishing.create({
        data: {
          projectId: String(body.projectId),
          driveLineId: body.driveLineId || null,
          date: new Date(body.date),
          siteCleaned: !!body.siteCleaned,
          wasteRemoved: !!body.wasteRemoved,
          shaftClosed: !!body.shaftClosed,
          siteRestored: !!body.siteRestored,
          lineHandover: !!body.lineHandover,
          clientNotes: body.clientNotes ? String(body.clientNotes) : null,
          handoverStatus: String(body.handoverStatus || 'pending'),
          signedBy: user.name,
          signedById: user.id,
          signedAt: new Date(),
        },
      }),
      'إنشاء التشطيب'
    )
    if (!createResult.success) return createResult.response

    // Audit log (non-critical)
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId,
          action: 'create',
          entity: 'finishing',
          entityId: createResult.data.id,
          details: 'Created finishing record',
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ finishing: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التشطيب')
  }
}
