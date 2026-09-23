import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite } from '@/lib/auth'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp, buildAuditDetails } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

// v26: تعديل تقرير السلامة من قسم السلامة
// - متاح لكل من يملك صلاحية كتابة السلامة (نفس بوابة الإنشاء)
// - القابل للتعديل: قائمة التحقق (15 بنداً) + الملاحظات + المخالفات + الحادث
// - بيانات التعريف (المشروع/خط الحفر/التاريخ) للقراءة فقط — هي هوية التقرير وربطه بالتقرير اليومي
// - القفل المطلق: بعد إرسال التقرير اليومي للاعتماد لا يُقبل أي تعديل أبداً
// - كل تعديل يُسجَّل في الرقابة بتفاصيل «قبل ← الآن» لكل حقل
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // استخراج معلومات المستخدم بعد فحص الـ null لإرضاء TypeScript داخل الـ callbacks
  var userId = user.id
  var userName = user.name

  // v38: الإدارة العليا تعدّل تقارير السلامة دائماً (بأي حالة)
  var isTopManagementUser = String(user.role || '').toLowerCase().trim() === 'top_management'
  if (!isTopManagementUser && !canWrite(user.role, 'safety', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'تعديل تقارير السلامة متاح للموظفين المصرّح لهم فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    const { id } = await params
    var body = await req.json()

    var existingResult = await safeDbOp(
      () => db.safetyReport.findUnique({
        where: { id: String(id) },
        include: {
          dailyReport: { select: { id: true, status: true } },
          project: { select: { name: true } },
        },
      }),
      'جلب تقرير السلامة'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'تقرير السلامة غير موجود' }, { status: 404 })
    }

    // القفل المطلق: بعد إرسال التقرير اليومي من قسم التقارير اليومية (submitted/approved/rejected)
    // لا يمكن تعديل تقرير السلامة أبداً — التعديل متاح في مرحلة المسودة فقط
    var dailyStatus = (existing.dailyReport && existing.dailyReport.status) || 'draft'
    // v38: القفل المطلق يستثني الإدارة العليا — تعدّل تقارير السلامة في أي حالة
    if (!isTopManagementUser && dailyStatus !== 'draft') {
      return NextResponse.json(
        { error: 'report_locked', message: 'لا يمكن تعديل تقرير السلامة بعد إرسال التقرير اليومي للاعتماد' },
        { status: 409 }
      )
    }

    // SECURITY: قائمة سماح لنوع الحادث (نفس منطق مسارات الحفظ الأخرى)
    var VALID_INCIDENT_TYPES = ['none', 'near_miss', 'incident', 'accident']
    var incidentType = VALID_INCIDENT_TYPES.includes(String(body.incidentType)) ? String(body.incidentType) : 'none'

    // لقطة «قبل» وقيم «بعد» لتوليد تفاصيل التغيير لكل حقل
    var CHECK_KEYS = ['ppeAvailable', 'helmetCheck', 'bootsCheck', 'glovesCheck', 'glassesCheck', 'workAreaCheck', 'barriersCheck', 'shaftCheck', 'ventilationCheck', 'electricalCheck', 'craneCheck', 'hydraulicCheck', 'fireExtinguishers', 'workPermit', 'toolboxTalk']
    var oldSnapshot: any = {}
    var newSnapshot: any = {}
    var updateData: any = {}

    for (var i = 0; i < CHECK_KEYS.length; i++) {
      var ck = CHECK_KEYS[i]
      oldSnapshot[ck] = (existing as any)[ck]
      var cb = !!body[ck]
      updateData[ck] = cb
      newSnapshot[ck] = cb
    }

    var TEXT_KEYS = ['observations', 'violations']
    for (var j = 0; j < TEXT_KEYS.length; j++) {
      var tk = TEXT_KEYS[j]
      oldSnapshot[tk] = (existing as any)[tk]
      var tv = body[tk] ? String(body[tk]).slice(0, 5000) : null
      updateData[tk] = tv
      newSnapshot[tk] = tv
    }

    oldSnapshot.incidentType = existing.incidentType
    oldSnapshot.incidentDescription = existing.incidentDescription
    updateData.incidentType = incidentType
    updateData.incidentDescription = incidentType !== 'none' && body.incidentDescription ? String(body.incidentDescription).slice(0, 5000) : null
    newSnapshot.incidentType = updateData.incidentType
    newSnapshot.incidentDescription = updateData.incidentDescription

    // التحديث يعيد التوقيع باسم المحرِّر (نفس سلوك مسارات حفظ السلامة الأخرى)
    updateData.signedBy = userName
    updateData.signedById = userId
    updateData.signedAt = new Date()

    var summary = 'تعديل تقرير السلامة — ' + (existing.project ? existing.project.name : '') + ' بتاريخ ' + new Date(existing.reportDate).toISOString().split('T')[0]
    var details = buildAuditDetails(oldSnapshot, newSnapshot, summary)

    var updatedResult = await safeDbOp(
      () => db.safetyReport.update({ where: { id: String(id) }, data: updateData }),
      'تحديث تقرير السلامة'
    )
    if (!updatedResult.success) return updatedResult.response

    // سجل التدقيق — يظهر في قسم الرقابة بتفاصيل «قبل ← الآن» لكل حقل
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: userId,
          projectId: existing.projectId,
          dailyReportId: existing.dailyReportId,
          action: 'update',
          entity: 'safety_report',
          entityId: String(id),
          details: details,
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({ success: true, safetyReport: updatedResult.data })
  } catch (error: any) {
    return handleDbError(error, 'تعديل تقرير السلامة')
  }
}

