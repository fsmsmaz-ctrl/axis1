// ============================================================
// v123 — مستحقات مقاولي الحفر النفقي — واجهة القسم
// AXIS Pipe Jacking Management System
// ============================================================
// GET  /api/contractor-dues — قراءة شاملة: كل خطوط الحفر مع
//      المستحقات التراكمية المحسوبة من المصدر + فواتير المقاولين
//      ودورات اعتمادها. المتاحون: أصحاب صلاحية التكاليف (أو تقاريرها)
//      وأصحاب مفاتيح دورة الاعتماد الثلاثة ومدير النظام — القسم
//      مالي أصلاً ولا يراه الزائر إطلاقاً.
// POST /api/contractor-dues — إجراءات على عقد الخط:
//      set_agreement          إدخال/تحديث اسم المقاول وسعر المتر وتاريخ البدء
//                             (السعر بعد بدء العمل = تعديل معتمد مع سبب وسجل)
//      request_verification   إرسال الخط المكتمل لمراجعة المهندس (إشعار آلي)
//      price_change           تعديل سعر معتمد (الإدارة/المالي) مع سجل التغيير
//      planned_length_change  تعديل طول مخطط معتمد — الباب الوحيد لتجاوز الطول
// الخادم هو المصدر: كل صلاحية وحساب وقاعدة يفرضها الخادم.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { hasPermission, canWrite, canReviewContractorFinancial, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { computeAllContractorDues, round3 } from '@/lib/contractor-dues'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { notifyUsers } from '@/lib/notify'

export const dynamic = 'force-dynamic'

function str(v: unknown, max: number): string {
  var s = String(v == null ? '' : v).trim()
  return s.slice(0, max)
}
function num(v: unknown): number {
  var n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function isAdminEmail(email: string): boolean {
  return String(email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
}

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.read)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || isAdminEmail(email)
  var canRead = isSystemAdmin
    || hasPermission(me.role, 'costs', me.permissions, me.email)
    || hasPermission(me.role, 'rpt_costs', me.permissions, me.email)
    || hasPermission(me.role, 'rpt_revenue', me.permissions, me.email)
    || hasPermission(me.role, 'rpt_profit', me.permissions, me.email)
    || me.permissions?.contractor_tech_review === true
    || me.permissions?.contractor_finance_review === true
    || me.permissions?.contractor_owner_final === true
  if (!canRead) {
    return NextResponse.json({ error: 'forbidden', message: 'مستحقات المقاولين بيانات مالية — لا تملك صلاحية الوصول' }, { status: 403 })
  }

  try {
    var data = await computeAllContractorDues()
    return NextResponse.json({
      lines: data.lines,
      invoices: data.invoices,
      viewer: {
        canWriteCosts: canWrite(me.role, 'costs', me.permissions) || isSystemAdmin,
        canTechReview: me.permissions?.contractor_tech_review === true || isSystemAdmin,
        canFinanceReview: me.permissions?.contractor_finance_review === true || isSystemAdmin,
        canFinalApprove: me.permissions?.contractor_owner_final === true || isSystemAdmin,
        isAdmin: isSystemAdmin,
      },
    })
  } catch (e: any) {
    console.error('[contractor-dues GET] failed:', e)
    return NextResponse.json({ error: 'server_error', message: 'فشل حساب المستحقات — أعد المحاولة' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad_request', message: 'طلب غير صالح' }, { status: 400 })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || isAdminEmail(email)
  var costsWrite = canWrite(me.role, 'costs', me.permissions) || isSystemAdmin
  var financeReview = canReviewContractorFinancial(me) || isSystemAdmin
  var action = str(body.action, 40)

  try {
    await ensureContractorDuesSupport()
  } catch (e: any) {
    console.error('[contractor-dues POST] self-heal failed:', e)
  }

  // ── إدخال/تحديث عقد الخط: اسم المقاول + سعر المتر + تاريخ بدء العمل ──
  if (action === 'set_agreement') {
    if (!costsWrite && !financeReview) {
      return NextResponse.json({ error: 'forbidden', message: 'إدخال عقد المقاول متاح لمن يملك صلاحية كتابة التكاليف أو الاعتماد المالي' }, { status: 403 })
    }
    var driveLineId = str(body.driveLineId, 64)
    if (!driveLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })

    var line = await db.driveLine.findUnique({ where: { id: driveLineId }, include: { project: { select: { name: true } } } })
    if (!line) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })

    var contractorName = str(body.contractorName, 160)
    var hasPriceInput = body.pricePerMeter !== undefined && body.pricePerMeter !== null && String(body.pricePerMeter).trim() !== ''
    var newPrice = hasPriceInput ? round3(num(body.pricePerMeter)) : null
    if (hasPriceInput && ((newPrice as number) < 0 || (newPrice as number) > 1000000)) {
      return NextResponse.json({ error: 'bad_request', message: 'سعر المتر يجب أن يكون رقماً بين 0 و 1,000,000 ريال عماني' }, { status: 400 })
    }
    var plannedStart: Date | null = null
    if (body.plannedStartDate && String(body.plannedStartDate).trim() !== '') {
      plannedStart = new Date(String(body.plannedStartDate).trim())
      if (isNaN(plannedStart.getTime())) plannedStart = null
    }

    var oldPrice = Number(line.pricePerMeter) || 0
    var priceChanged = hasPriceInput && (newPrice as number) !== round3(oldPrice)
    var lineStarted = line.status !== 'not_started'

    // المواصفة: السعر لا يُغيَّر بعد بدء العمل إلا بتعديل معتمد من الإدارة مع سجل التغيير
    if (priceChanged && lineStarted && oldPrice > 0) {
      var reason = str(body.changeReason, 500)
      if (!financeReview && !isSystemAdmin) {
        return NextResponse.json({ error: 'forbidden', message: 'تغيير سعر المقاول بعد بدء العمل محصور بالاعتماد المالي أو مدير النظام — مع ذكر السبب' }, { status: 403 })
      }
      if (reason.length < 3) {
        return NextResponse.json({ error: 'bad_request', message: 'سبب تعديل السعر إجباري (3 أحرف على الأقل) — لا تغيير صامت للسعر أبداً' }, { status: 400 })
      }
      await db.contractorLineChange.create({
        data: {
          driveLineId: line.id,
          changeType: 'price',
          oldValue: oldPrice,
          newValue: newPrice as number,
          reason: reason,
          approvedById: me.id,
          approvedByName: me.name,
        },
      })
    }

    var updated = await db.driveLine.update({
      where: { id: line.id },
      data: {
        contractorName: contractorName || line.contractorName,
        pricePerMeter: hasPriceInput ? newPrice : line.pricePerMeter,
        plannedStartDate: plannedStart !== null ? plannedStart : line.plannedStartDate,
      },
    })

    await db.auditLog.create({
      data: {
        userId: me.id,
        projectId: line.projectId,
        action: 'update',
        entity: 'drive_line',
        entityId: line.id,
        details: 'تحديث عقد المقاول للخط ' + line.lineNumber + ' — المقاول: ' + (updated.contractorName || 'غير محدد') + ' — السعر: ' + (updated.pricePerMeter != null ? updated.pricePerMeter + ' ر.ع/م' : 'غير محدد') + (priceChanged && lineStarted && oldPrice > 0 ? ' (تعديل معتمد بعد بدء العمل — سُجل في سجل التغييرات)' : ''),
      },
    })

    return NextResponse.json({ ok: true, message: 'حُفظ عقد المقاول للخط ' + line.lineNumber, line: { id: updated.id, contractorName: updated.contractorName, pricePerMeter: updated.pricePerMeter, plannedStartDate: updated.plannedStartDate } })
  }

  // ── إرسال الخط المكتمل لمراجعة المهندس (Completed → Pending Engineer Verification) ──
  if (action === 'request_verification') {
    if (!costsWrite) {
      return NextResponse.json({ error: 'forbidden', message: 'إرسال الخط للمراجعة الفنية متاح لمن يملك صلاحية كتابة التكاليف' }, { status: 403 })
    }
    var rvLineId = str(body.driveLineId, 64)
    if (!rvLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })

    var vLine = await db.driveLine.findUnique({ where: { id: rvLineId }, include: { project: { select: { name: true } } } })
    if (!vLine) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })
    if (vLine.status !== 'completed') {
      return NextResponse.json({ error: 'bad_request', message: 'يجب أن يكون الخط مكتمل الحفر (Completed) قبل إرساله لمراجعة المهندس — الحالة الحالية: ' + vLine.status }, { status: 400 })
    }
    if (!vLine.contractorName || !String(vLine.contractorName).trim() || !(Number(vLine.pricePerMeter) > 0)) {
      return NextResponse.json({ error: 'bad_request', message: 'عقد المقاول غير مكتمل — أدخل اسم المقاول وسعر المتر قبل إرسال المراجعة' }, { status: 400 })
    }
    var activeInv = await db.contractorInvoice.findFirst({ where: { driveLineId: vLine.id, status: { in: ['pending_financial', 'pending_final', 'approved', 'partially_paid', 'paid'] } }, select: { invoiceNo: true } })
    if (activeInv) {
      return NextResponse.json({ error: 'duplicate_invoice', message: 'يوجد فاتورة نشطة لهذا الخط (' + activeInv.invoiceNo + ') — لا حاجة لإعادة الإرسال' }, { status: 409 })
    }

    // حساب الأطوال الفعلية للإشعار — من المصدر مباشرة
    var agg = await db.dailyReport.aggregate({
      where: { driveLineId: vLine.id, status: 'approved' },
      _sum: { dailyMeters: true, pipeJackedMeters: true },
    })
    var excavated = round3(Math.max(0, Number(agg._sum.dailyMeters) || 0))
    var piped = round3(Math.max(0, Number(agg._sum.pipeJackedMeters) || 0))
    var price = Number(vLine.pricePerMeter) || 0
    var accrued = round3(excavated * price)

    await db.driveLine.update({
      where: { id: vLine.id },
      data: {
        status: 'pending_verification',
        submittedById: me.id,
        submittedByName: me.name,
        submittedAt: new Date(),
        verificationNote: null,
      },
    })

    await db.auditLog.create({
      data: {
        userId: me.id,
        projectId: vLine.projectId,
        action: 'update',
        entity: 'drive_line',
        entityId: vLine.id,
        details: 'إرسال الخط ' + vLine.lineNumber + ' لمراجعة المهندس — الحفر الفعلي: ' + excavated + ' م، الأنابيب المدفوعة: ' + piped + ' م، السعر: ' + price + ' ر.ع/م، المستحق التراكمي: ' + accrued + ' ر.ع',
      },
    })

    try {
      await notifyUsers({
        type: 'contractor_line_verification',
        title: 'خط حفر مكتمل بانتظار مراجعة الأطوال فنياً',
        message: 'الخط ' + vLine.lineNumber + ' — المشروع: ' + (vLine.project ? vLine.project.name : '') + ' — المقاول: ' + String(vLine.contractorName).trim() + ' — الطول المخطط: ' + vLine.totalLength + ' م — الحفر الفعلي المسجل: ' + excavated + ' م — الأنابيب المدفوعة (للمراجعة الفنية): ' + piped + ' م — سعر المتر: ' + price + ' ر.ع — إجمالي المستحقات المحسوبة: ' + accrued + ' ر.ع — قُدّم بواسطة: ' + me.name + ' — يرجى مراجعة الأطوال واعتمادها أو طلب تعديل.',
        severity: 'warning',
        entityType: 'drive_line',
        entityId: vLine.id,
        link: 'costs',
        permissions: ['contractor_tech_review'],
        includeSystemAdmin: true,
      })
    } catch (nE) {
      console.error('[contractor-dues] notify tech reviewers failed (non-fatal):', nE)
    }

    return NextResponse.json({ ok: true, message: 'أُرسل الخط ' + vLine.lineNumber + ' لمراجعة المهندس — وصل الإشعار لأصحاب صلاحية المراجعة الفنية', excavated: excavated, pipeJacked: piped, accrued: accrued })
  }

  // ── تعديل سعر معتمد (مباشر — للإدارة/المالي فقط) ──
  if (action === 'price_change') {
    if (!financeReview && !isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل السعر المعتمد محصور بالاعتماد المالي أو مدير النظام' }, { status: 403 })
    }
    var pcLineId = str(body.driveLineId, 64)
    if (!pcLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })
    var pcLine = await db.driveLine.findUnique({ where: { id: pcLineId } })
    if (!pcLine) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })
    var newP = round3(num(body.newPrice))
    if (newP <= 0 || newP > 1000000) {
      return NextResponse.json({ error: 'bad_request', message: 'السعر الجديد يجب أن يكون رقماً موجباً منطقياً' }, { status: 400 })
    }
    var pcReason = str(body.reason, 500)
    if (pcReason.length < 3) {
      return NextResponse.json({ error: 'bad_request', message: 'سبب التعديل إجباري — لا تغيير صامت للسعر' }, { status: 400 })
    }
    var oldP = Number(pcLine.pricePerMeter) || 0
    await db.contractorLineChange.create({
      data: { driveLineId: pcLine.id, changeType: 'price', oldValue: oldP, newValue: newP, reason: pcReason, approvedById: me.id, approvedByName: me.name },
    })
    await db.driveLine.update({ where: { id: pcLine.id }, data: { pricePerMeter: newP } })
    await db.auditLog.create({
      data: { userId: me.id, projectId: pcLine.projectId, action: 'update', entity: 'drive_line', entityId: pcLine.id, details: 'تعديل سعر المقاول المعتمد للخط ' + pcLine.lineNumber + ': من ' + oldP + ' إلى ' + newP + ' ر.ع/م — السبب: ' + pcReason },
    })
    return NextResponse.json({ ok: true, message: 'عُدّل السعر وسُجل التغيير باسمك وسببه' })
  }

  // ── تعديل طول مخطط معتمد — الباب الوحيد لاحتساب أطوال تتجاوز المخطط الأصلي ──
  if (action === 'planned_length_change') {
    if (!financeReview && !isSystemAdmin) {
      return NextResponse.json({ error: 'forbidden', message: 'تعديل الطول المخطط محصور بالاعتماد المالي أو مدير النظام' }, { status: 403 })
    }
    var plLineId = str(body.driveLineId, 64)
    if (!plLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })
    var plLine = await db.driveLine.findUnique({ where: { id: plLineId } })
    if (!plLine) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })
    var newL = round3(num(body.newLength))
    if (newL <= 0 || newL > 100000) {
      return NextResponse.json({ error: 'bad_request', message: 'الطول الجديد يجب أن يكون رقماً موجباً منطقياً (متر)' }, { status: 400 })
    }
    var plReason = str(body.reason, 500)
    if (plReason.length < 3) {
      return NextResponse.json({ error: 'bad_request', message: 'سبب التعديل إجباري — لا تغيير صامت للطول المخطط' }, { status: 400 })
    }
    var lastExt = await db.contractorLineChange.findFirst({ where: { driveLineId: plLine.id, changeType: 'planned_length' }, orderBy: { createdAt: 'desc' } })
    var oldL = lastExt && Number(lastExt.newValue) > 0 ? Number(lastExt.newValue) : (Number(plLine.totalLength) || 0)
    if (newL <= oldL) {
      return NextResponse.json({ error: 'bad_request', message: 'الطول الجديد يجب أن يكون أكبر من الحد الحالي (' + oldL + ' م) — التعديل مخصص لتجاوز المخطط فقط' }, { status: 400 })
    }
    await db.contractorLineChange.create({
      data: { driveLineId: plLine.id, changeType: 'planned_length', oldValue: oldL, newValue: newL, reason: plReason, approvedById: me.id, approvedByName: me.name },
    })
    await db.auditLog.create({
      data: { userId: me.id, projectId: plLine.projectId, action: 'update', entity: 'drive_line', entityId: plLine.id, details: 'تعديل الطول المخطط المعتمد للخط ' + plLine.lineNumber + ': من ' + oldL + ' إلى ' + newL + ' م — السبب: ' + plReason },
    })
    return NextResponse.json({ ok: true, message: 'عُدّل الطول المخطط المعتمد وسُجل التغيير — أصبح احتساب المستحقات حتى ' + newL + ' م مرخصاً' })
  }

  return NextResponse.json({ error: 'bad_request', message: 'إجراء غير معروف — الإجراءات المتاحة: set_agreement, request_verification, price_change, planned_length_change' }, { status: 400 })
}
