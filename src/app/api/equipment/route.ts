import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
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
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // Rate limit write operations
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json()

    var validationError = validateRequired(body, ['name', 'number', 'type'])
    if (validationError) return validationError

    // Check for duplicate number
    var dupResult = await safeDbOp(
      () => db.equipment.findUnique({ where: { number: String(body.number).trim() } }),
      'فحص الرمز المكرر'
    )
    if (dupResult.success && dupResult.data) {
      return NextResponse.json({
        error: 'duplicate_number',
        message: 'المعدة برقم "' + body.number + '" موجودة بالفعل',
      }, { status: 400 })
    }

    var createResult = await safeDbOp(
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

    // Audit log + notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: body.projectId,
            action: 'create',
            entity: 'equipment',
            entityId: createResult.data.id,
            details: 'Created equipment ' + createResult.data.number + ' - ' + createResult.data.name,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: body.projectId,
            type: 'equipment_breakdown',
            title: 'إضافة معدة جديدة',
            message: 'تم إضافة معدة: ' + createResult.data.number + ' - ' + createResult.data.name + ' بواسطة ' + user.name,
            severity: 'info',
          },
        }),
        'إشعار الإضافة'
      ),
    ]).catch(function() {})

    return NextResponse.json({ equipment: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المعدة')
  }
}
