import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp, parseDateRange } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { canWrite } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    const searchParams = new URL(req.url).searchParams
    const projectId = searchParams.get('projectId')
    // M-4 FIX: Pagination
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const where: any = {}
    if (projectId) where.projectId = projectId

    // Period range filter (from/to) — used by the Reports section's
    // handover report so the selected period filters the records.
    const dateRange = parseDateRange(searchParams.get('from'), searchParams.get('to'))
    if (dateRange.gte || dateRange.lt) where.date = dateRange

    const result = await safeDbOp(
      () => db.finishing.findMany({
        where, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { project: { select: { id: true, name: true, code: true } }, signedByUser: { select: { name: true, nameEn: true } } },
      }), 'جلب التشطيبات'
    )
    if (!result.success) return result.response
    return NextResponse.json({ finishings: result.data, page, limit })
  } catch (error: any) {
    return handleDbError(error, 'جلب التشطيبات')
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  // H-1 FIX: RBAC check
  if (!canWrite(user.role, 'finishings', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإنشاء تشطيبات' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  try {
    const body = await req.json()
    const validationError = validateRequired(body, ['projectId', 'date'])
    if (validationError) return validationError

    const createResult = await safeDbOp(
      () => db.finishing.create({
        data: { projectId: String(body.projectId), driveLineId: body.driveLineId || null, date: new Date(body.date), siteCleaned: !!body.siteCleaned, wasteRemoved: !!body.wasteRemoved, shaftClosed: !!body.shaftClosed, siteRestored: !!body.siteRestored, lineHandover: !!body.lineHandover, clientNotes: body.clientNotes ? String(body.clientNotes) : null, handoverStatus: String(body.handoverStatus || 'pending'), signedBy: user.name, signedById: user.id, signedAt: new Date() },
      }), 'إنشاء التشطيب'
    )
    if (!createResult.success) return createResult.response

    safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: body.projectId, action: 'create', entity: 'finishing', entityId: createResult.data.id, details: 'Created finishing record' } }), 'سجل التدقيق').catch(() => {})

    return NextResponse.json({ finishing: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء التشطيب')
  }
}
