import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  var searchParams = new URL(req.url).searchParams
  var projectId = searchParams.get('projectId')

  var where: any = {}
  if (projectId) where.projectId = projectId

  var result = await safeDbOp(
    () => db.worker.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { name: true, nameEn: true } },
      },
    }),
    'fetch workers'
  )

  if (!result.success) return result.response

  return NextResponse.json({ workers: result.data })
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()
    var validationError = validateRequired(body, ['name', 'phone'])
    if (validationError) return validationError

    var userId = user.id

    var result = await safeDbOp(
      () => db.worker.create({
        data: {
          name: String(body.name),
          phone: String(body.phone),
          contractorName: body.contractorName ? String(body.contractorName) : null,
          projectId: body.projectId ? String(body.projectId) : null,
          notes: body.notes ? String(body.notes) : null,
          createdById: userId,
        },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { name: true, nameEn: true } },
        },
      }),
      'create worker'
    )

    if (!result.success) return result.response
    return NextResponse.json({ worker: result.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'create worker')
  }
}
