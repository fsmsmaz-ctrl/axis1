import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
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
        project: { select: { id: true, name: true, code: true } },
      },
    }),
    'جلب بيانات العمال'
  )

  if (!result.success) return result.response
  return NextResponse.json({ workers: result.data })
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()

    if (!body.name || !body.phone) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'اسم العامل ورقم التواصل مطلوبان' },
        { status: 400 }
      )
    }

    var createResult = await safeDbOp(
      () => db.worker.create({
        data: {
          name: body.name,
          phone: body.phone,
          contractorName: body.contractorName || null,
          projectId: body.projectId || null,
          notes: body.notes || null,
          createdById: user.id,
        },
        include: {
          project: { select: { id: true, name: true, code: true } },
        },
      }),
      'إضافة عامل'
    )

    if (!createResult.success) return createResult.response

    // Audit log
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: body.projectId || null,
          action: 'create',
          entity: 'worker',
          entityId: createResult.data.id,
          details: 'Added worker: ' + body.name,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ worker: createResult.data })
  } catch (error: any) {
    return handleDbError(error, 'إضافة عامل')
  }
}
