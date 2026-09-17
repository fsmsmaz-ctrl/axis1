import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { buildAuditDetails, handleDbError, parseNumber, safeDbOp, sanitizeDriveLine } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'
import { notifyUsers } from '@/lib/notify'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'

// أدوار مسموح لها بتغيير الأسعار — SECURITY FIX: كان مهندس الموقع ومسؤول السلامة
// يستطيعان تغيير سعر المتر فيُعاد حساب إيرادات التقارير المعتمدة بصمت
// v14.2: الحكم النهائي عبر canViewPricing — تستثني المشرف العام (admin@axis.om)
// صراحةً حتى لو كان دوره top_management، فتغيير السعر فعل مالي إداري محصور
// بالإدارة العليا ومدير المشروع حصراً.
import { canViewPricing as canChangePricing } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'drive_lines', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل خطوط الحفر' }, { status: 403 })
    }

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json(
        { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
    var { id } = await params
    var body = await req.json()

    var existingResult = await safeDbOp(
      () => db.driveLine.findUnique({ where: { id }, select: { projectId: true, lineNumber: true, startPoint: true, endPoint: true, totalLength: true, status: true, pricePerMeter: true, diameter: true, pipeType: true, soilType: true, depth: true, problems: true } }),
      'البحث عن خط الحفر'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })

    var updateData: any = {}
    if (body.projectId !== undefined) updateData.projectId = String(body.projectId)
    if (body.lineNumber !== undefined) updateData.lineNumber = String(body.lineNumber).trim()
    if (body.startPoint !== undefined) updateData.startPoint = String(body.startPoint).trim()
    if (body.endPoint !== undefined) updateData.endPoint = String(body.endPoint).trim()
    if (body.totalLength !== undefined) updateData.totalLength = parseNumber(body.totalLength, 0)
    if (body.diameter !== undefined) updateData.diameter = String(body.diameter)
    if (body.pipeType !== undefined) updateData.pipeType = String(body.pipeType)
    if (body.soilType !== undefined) updateData.soilType = String(body.soilType)
    if (body.depth !== undefined) updateData.depth = parseNumber(body.depth, 0)
    // v13: سعر المتر الخاص بالخط — تغييره يعيد حساب كل تقارير هذا الخط بدقة
    // SECURITY FIX: تغيير السعر مقيّد بالإدارة العليا ومدير المشروع فقط لأنه يعيد
    // كتابة الإيرادات التاريخية (بما فيها التقارير المعتمدة) — وهو فعل مالي إداري
    var priceChanged = false
    if (body.pricePerMeter !== undefined) {
      // v14.2 SECURITY FIX: كان الكود يمنح المشرف العام صراحةً حق تغيير السعر
      // (|| user.email === 'admin@axis.om') — أُلغي الاستثناء. الآن:
      // 1) غير المصرح له (بما فيهم المشرف) يُتجاهل طلبه للسعر بصمت مع بقاء بقية التعديلات
      // 2) المصرح له فقط (الإدارة العليا + مدير المشروع) يمرّ عبر فحوصات التحقق
      if (!canChangePricing(user)) {
        delete body.pricePerMeter
      } else {
        var newPrice = (body.pricePerMeter === null || String(body.pricePerMeter) === '')
          ? null
          : parseNumber(body.pricePerMeter, 0)
        // SECURITY FIX: منع الأسعار السالبة أو العملاقة
        if (newPrice !== null && (!Number.isFinite(newPrice) || newPrice < 0 || newPrice > 100000)) {
          return NextResponse.json(
            { error: 'invalid_price', message: 'سعر المتر يجب أن يكون رقماً موجباً ومعقولاً' },
            { status: 400 }
          )
        }
        if (newPrice !== existing.pricePerMeter) priceChanged = true
        updateData.pricePerMeter = newPrice
      }
    }
    if (body.status !== undefined) updateData.status = String(body.status)
    if (body.problems !== undefined) updateData.problems = body.problems ? String(body.problems) : null

    var updateResult = await safeDbOp(
      () => db.driveLine.update({ where: { id }, data: updateData }),
      'تحديث خط الحفر'
    )
    if (!updateResult.success) return updateResult.response

    // v13: عند تغيّر سعر المتر — إعادة حساب dailyRevenue لكل تقارير هذا الخط
    // (القديمة والجديدة والمسودات والمعتمدة) = الأمتار × السعر الجديد
    var recalculatedReports = 0
    if (priceChanged) {
      try {
        var lineReports = await db.dailyReport.findMany({
          where: { driveLineId: id },
          select: { id: true, dailyMeters: true, dailyRevenue: true },
        })
        var finalPrice = updateResult.data.pricePerMeter
        if (finalPrice == null) {
          // بلا سعر للخط: ارجع لسعر المشروع احتياطياً
          var projPriceResult = await safeDbOp(
            () => db.project.findUnique({ where: { id: existing.projectId }, select: { pricePerMeter: true } }),
            'جلب سعر المتر'
          )
          finalPrice = projPriceResult.success && projPriceResult.data && projPriceResult.data.pricePerMeter != null ? projPriceResult.data.pricePerMeter : 0
        }
        for (const lr of lineReports) {
          const correctRevenue = (lr.dailyMeters || 0) * (finalPrice || 0)
          if (Math.abs((lr.dailyRevenue || 0) - correctRevenue) > 0.001) {
            await db.dailyReport.update({ where: { id: lr.id }, data: { dailyRevenue: correctRevenue } })
            recalculatedReports++
          }
        }
      } catch (e) {
        // لا نفشل عملية التعديل إذا تعذرت إعادة الحساب — يمكن إعادة الحساب من /api/admin/recalc-all
      }
    }

    Promise.all([
      safeDbOp(() => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: existing.projectId,
          action: 'update',
          entity: 'drive_line',
          entityId: id,
          // v22: توثيق دقيق لكل حقل تغيّر — القيمة قبل ← القيمة الآن (JSON)
          details: buildAuditDetails(
            existing as unknown as Record<string, any>,
            updateResult.data as unknown as Record<string, any>,
            'تعديل خط الحفر: ' + existing.lineNumber + ' (' + existing.startPoint + ' → ' + existing.endPoint + ')' + (priceChanged ? ' — أعيد حساب ' + recalculatedReports + ' تقرير' : ''),
            { skipFields: ['id', 'createdAt', 'updatedAt', 'projectId', 'cuid'] }
          ),
        },
      }), 'سجل التدقيق'),
    ]).catch(function() {})

    // ── تنبيه اكتمال خط الحفر عند الانتقال إلى حالة "مكتمل" ──
    // فقط إذا لم يكن مكتملاً سابقاً (انتقال فعلي وليس تعديلاً متكرراً)
    if (String(body.status) === 'completed' && existing.status !== 'completed') {
      notifyUsers({
        type: 'drive_line_completed',
        title: 'اكتمال خط حفر',
        message: 'تم اكتمال خط الحفر رقم ' + existing.lineNumber + ' (' + existing.startPoint + ' → ' + existing.endPoint + ') بطول ' + (existing.totalLength || 0) + ' متر بنجاح — يمكنك مراجعة بياناته وإصدار التشطيب.',
        severity: 'info',
        projectId: existing.projectId,
        link: 'driveLines',
        entityType: 'drive_line',
        entityId: id,
        permissions: ['drive_lines', 'finishings'],
        roles: ['top_management', 'project_manager'],
        excludeUserIds: [user.id],
      }).catch(function() {})
    }

    // v14.2 SECURITY: الرد مُعقّم — المستخدم غير المصرح له لا يتلقى السعر حتى لو عدّل حقلاً آخر
    return NextResponse.json({ driveLine: sanitizeDriveLine(updateResult.data, canChangePricing(user)), success: true, recalculatedReports })
  } catch (error: any) {
    return handleDbError(error, 'تحديث خط الحفر')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'drive_lines', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف خطوط الحفر' }, { status: 403 })
    }

    var { id } = await params

    var existingResult = await safeDbOp(
      () => db.driveLine.findUnique({ where: { id }, select: { projectId: true, lineNumber: true, startPoint: true, endPoint: true } }),
      'البحث عن خط الحفر'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data
    if (!existing) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })

    var deleteResult = await safeDbOp(() => db.driveLine.delete({ where: { id } }), 'حذف خط الحفر')
    if (!deleteResult.success) return deleteResult.response

    Promise.all([
      safeDbOp(() => db.auditLog.create({
        data: {
          userId: user.id,
          projectId: existing.projectId,
          action: 'delete',
          entity: 'drive_line',
          entityId: id,
          details: 'حذف خط الحفر: ' + existing.lineNumber + ' (' + existing.startPoint + ' → ' + existing.endPoint + ')',
        },
      }), 'سجل التدقيق'),
    ]).catch(function() {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف خط الحفر')
  }
}

