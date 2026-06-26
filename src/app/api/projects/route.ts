import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, parseDate, safeDbOp } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({
      error: 'unauthorized',
      message: 'يجب تسجيل الدخول أولاً',
    }, { status: 401 })
  }

  try {
    const body = await req.json()

    // Validate required fields
    const validationError = validateRequired(body, [
      'code', 'name', 'client', 'location', 'workType', 'pipeDiameter', 'soilType'
    ])
    if (validationError) return validationError

    // Parse values safely
    const totalLength = parseNumber(body.totalLength, 0)
    const pricePerMeter = parseNumber(body.pricePerMeter, 0)
    const startDate = parseDate(body.startDate, 0)
    const expectedEnd = parseDate(body.expectedEnd, 90)

    // Check for duplicate code
    const dupCheck = await safeDbOp(
      () => db.project.findUnique({ where: { code: String(body.code).trim() } }),
      'فحص الرمز المكرر'
    )
    if (!dupCheck.success) return dupCheck.response
    if (dupCheck.data) {
      return NextResponse.json({
        error: 'duplicate_code',
        message: `المشروع برمز "${body.code}" موجود بالفعل. يرجى استخدام رمز مختلف.`,
      }, { status: 400 })
    }

    // Create project
    const createResult = await safeDbOp(
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

    // Audit log (non-critical)
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: createResult.data.id,
          action: 'create',
          entity: 'project',
          entityId: createResult.data.id,
          details: `Created project ${createResult.data.code}`,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ project: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المشروع')
  }
}
