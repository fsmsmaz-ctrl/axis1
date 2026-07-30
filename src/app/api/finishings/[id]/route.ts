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

  var finishing = await db.finishing.findUnique({
    where: { id },
    include: { project: true, signedByUser: true, attachments: true },
  })

  if (!finishing) {
    return NextResponse.json({ error: 'Finishing not found' }, { status: 404 })
  }

  return NextResponse.json({ finishing })
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
  var body = await req.json()

  try {
    // Fetch old data before update
    var oldFin = await safeDbOp(
      () => db.finishing.findUnique({ where: { id } }),
      'جلب التشطيب القديم'
    )

    var updateResult = await safeDbOp(
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
    var details = oldFin.success && oldFin.data
      ? buildAuditDetails(
          oldFin.data,
          body,
          'تعديل التشطيب',
          { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'driveLineId', 'date', 'signedBy', 'signedById', 'signedAt'] }
        )
      : 'تعديل التشطيب'

    // Audit log
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: updateResult.data.projectId, action: 'update', entity: 'finishing', entityId: id, details },
        }),
        'سجل التدقيق'
      ),
    ]).catch(function() {})

    return NextResponse.json({ finishing: updateResult.data })
  } catch (error) {
    console.error('Update finishing error:', error)
    return handleDbError(error, 'تحديث التشطيب')
  }
}
