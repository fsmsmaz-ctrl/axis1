import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, parseDate, safeDbOp, sanitizeProject } from '@/lib/api-helpers'
import { canWrite, canViewPricing } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول أولاً' }, { status: 401 })
  }

  // H-1 FIX: Check RBAC
  if (!canWrite(user.role, 'projects', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لإنشاء مشاريع' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const validationError = validateRequired(body, ['code', 'name', 'client', 'location', 'workType', 'pipeDiameter', 'soilType'])
    if (validationError) return validationError

    const totalLength = parseNumber(body.totalLength, 0)
    // v13: سعر المتر لم يعد مطلوباً عند إنشاء المشروع — الأسعار على مستوى خطوط الحفر
    // (v14.2: السعر يُعالج مباشرة في data مع فحص canViewPricing)
    const startDate = parseDate(body.startDate, 0)
    const expectedEnd = parseDate(body.expectedEnd, 90)

    const dupCheck = await safeDbOp(() => db.project.findUnique({ where: { code: String(body.code).trim() } }), 'فحص الرمز المكرر')
    if (!dupCheck.success) return dupCheck.response
    if (dupCheck.data) {
      return NextResponse.json({ error: 'duplicate_code', message: `المشروع برمز "${body.code}" موجود بالفعل` }, { status: 400 })
    }

    const createResult = await safeDbOp(
      () => db.project.create({
        data: {
          code: String(body.code).trim(), name: String(body.name).trim(), client: String(body.client).trim(),
          location: String(body.location || '').trim(), contractNumber: body.contractNumber ? String(body.contractNumber) : null,
          workType: String(body.workType), pipeDiameter: String(body.pipeDiameter),
          totalLength, 
          // v14.2 SECURITY: سعر المشروع يُقبل فقط من الإدارة العليا ومدير المشروع
          // (canViewPricing يستثني المشرف العام admin@axis.om) — غيرهم يُنشأ المشروع بلا سعر
          pricePerMeter: canViewPricing(user) && (body.pricePerMeter !== undefined && body.pricePerMeter !== null && String(body.pricePerMeter) !== '')
            ? parseNumber(body.pricePerMeter, 0)
            : null, 
          soilType: String(body.soilType),
          startDate, expectedEnd, status: String(body.status || 'not_started'),
          progress: 0, managerId: user.role === 'project_manager' ? user.id : (body.managerId || null),
          engineerId: body.engineerId || null, notes: body.notes ? String(body.notes) : null,
        },
      }),
      'إنشاء المشروع'
    )
    if (!createResult.success) return createResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({ data: { userId: user.id, projectId: createResult.data.id, action: 'create', entity: 'project', entityId: createResult.data.id, details: 'Created project ' + createResult.data.code } }), 'سجل التدقيق'),
      // FIX-6.4: Changed type from 'deadline_near' to 'project_created' (semantic correctness)
      safeDbOp(() => db.notification.create({ data: { projectId: createResult.data.id, type: 'project_created', title: 'مشروع جديد', message: 'تم إنشاء مشروع جديد: ' + createResult.data.code + ' بواسطة ' + user.name, severity: 'info' } }), 'إشعار'),
    ]).catch(() => {})

    // v14.2 SECURITY: الرد مُعقّم — لا سعر لمستخدم غير مصرح له
    return NextResponse.json({ project: sanitizeProject(createResult.data, canViewPricing(user)), success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء المشروع')
  }
}

