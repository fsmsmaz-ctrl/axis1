import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp, buildAuditDetails } from '@/lib/api-helpers'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const finishing = await db.finishing.findUnique({
    where: { id },
    include: { project: true, signedByUser: true, attachments: true },
  })

  if (!finishing) {
    return NextResponse.json({ error: 'Finishing not found' }, { status: 404 })
  }

  return NextResponse.json({ finishing })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    // Fetch old data before update
    const oldFin = await safeDbOp(
      () => db.finishing.findUnique({ where: { id } }),
      'جلب التشطيب القديم'
    )

    const updateResult = await safeDbOp(
      () => db.finishing.update({
        where: { id },
        data: {
          siteCleaned: !!body.siteCleaned,
          wasteRemoved: !!body.wasteRemoved,
          shaftClosed: !!body.shaftClosed,
          siteRestored: !!body.siteRestored,
          lineHandover: !!body.lineHandover,
          clientNotes: body.clientNotes,
          handoverStatus: body.handoverStatus,
        },
      }),
      'تحديث التشطيب'
    )
    if (!updateResult.success) return updateResult.response

    // Build detailed changes diff
    const details = oldFin.success && oldFin.data
      ? buildAuditDetails(
          oldFin.data,
          body,
          `تعديل التشطيب`,
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'driveLineId', 'date', 'signedBy', 'signedById', 'signedAt'] }
        )
      : `تعديل التشطيب`

    // Audit log (was missing before)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'finishing', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
    ]).catch(() => {})

    return NextResponse.json({ finishing: updateResult.data })
  } catch (error) {
    console.error('Update finishing error:', error)
    return NextResponse.json({ error: 'Failed to update finishing' }, { status: 500 })
  }
}
