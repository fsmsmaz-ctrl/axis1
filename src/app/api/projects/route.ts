import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, parseDate, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({
      error: 'unauthorized',
      message: 'يجب تسجيل الدخول أولاً',
    }, { status: 401 })
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

    // Validate required fields
    var validationError = validateRequired(body, [
      'code', 'name', 'client', 'location', 'workType', 'pipeDiameter', 'soilType'
    ])
    if (validationError) return validationError

    // Parse values safely
    var totalLength = parseNumber(body.totalLength, 0)
    var pricePerMeter = parseNumber(body.pricePerMeter, 0)
    var startDate = parseDate(body.startDate, 0)
    var expectedEnd = parseDate(body.expectedEnd, 90)

    // Check for duplicate code
    var dupCheck = await safeDbOp(
      () => db.project.findUnique({ where: { code: String(body.code).trim() } }),
      'فحص الرمز المكرر'
    )
    if (!dupCheck.success) return dupCheck.response
    if (dupCheck.data) {
      return NextResponse.json({
        error: 'duplicate_code',
        message: 'المشروع برمز "' + body.code + '" موجود بالفعل. يرجى استخدام رمز مختلف.',
      }, { status: 400 })
    }

    // Create project
    var createResult = await safeDbOp(
      () => db.project.create({
        data: {
          code: String(body.code).trim(),
          name: String(body.name).trim(),
          client: String(body.client).trim(),
          location: String(body.location || '').trim(),
          contractNumber: body.contractNumber ? String(body.contractNumber) : null,
          workType: String(body.workType),
          pipeDiameter: String(body.pipeDiameter),
          totalLength,
          pricePerMeter,
          soilType: String(body.soilType),
          startDate,
          expectedEnd,
          status: String(body.status || 'not_started'),
          progress: 0,
          managerId: user.role === 'project_manager' ? user.id : (body.managerId || null),
          engineerId: body.engineerId || null,
          notes: body.notes ? String(body.notes) : null,
        },
      }),
      'إنشاء المشروع'
    )
    if (!createResult.success) return createResult.response

    // Audit log + notification (non-critical, fire-and-forget)
    Promise.all([
      safeDbOp(
        () => db.auditLog.create({
          data: {
            userId: user.id,
            projectId: createResult.data.id,
            action: 'create',
            entity: 'project',
            entityId: createResult.data.id,
            details: 'Created project ' + createResult.data.code + ' - ' + createResult.data.name,
          },
        }),
        'سجل التدقيق'
      ),
      safeDbOp(
        () => db.notification.create({
          data: {
            projectId: createResult.data.id,
            type: 'deadline_near',
            title: 'مشروع جديد',
            message: 'تم إنشاء مشروع جديد: ' + createResult.data.code + ' - ' + createResult.data.name + ' بواسطة ' + user.name,
            severity: 'info',
          },
        }),
        'إشعار الإضافة'
      ),
    ]).catch(function() {})

    return NextResponse.json({ project: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المشروع')
  }
}
