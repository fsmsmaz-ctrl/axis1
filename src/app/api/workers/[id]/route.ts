import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  try {
    var body = await req.json()

    var result = await safeDbOp(
      () => db.worker.update({
        where: { id },
        data: {
          name: body.name !== undefined ? String(body.name) : undefined,
          phone: body.phone !== undefined ? String(body.phone) : undefined,
          contractorName: body.contractorName !== undefined ? (body.contractorName ? String(body.contractorName) : null) : undefined,
          projectId: body.projectId !== undefined ? (body.projectId ? String(body.projectId) : null) : undefined,
          notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
        },
        include: {
          project: { select: { id: true, name: true } },
          createdBy: { select: { name: true, nameEn: true } },
        },
      }),
      'update worker'
    )

    if (!result.success) return result.response
    return NextResponse.json({ worker: result.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'update worker')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params

  var result = await safeDbOp(
    () => db.worker.delete({ where: { id } }),
    'delete worker'
  )

  if (!result.success) return result.response
  return NextResponse.json({ success: true })
}
