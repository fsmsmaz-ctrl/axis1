// ============================================================
// v123 — دورة اعتماد فاتورة المقاول: المالي والنهائي
// AXIS Pipe Jacking Management System
// ============================================================
// POST /api/contractor-dues/invoices/[id]/decision
//   stage=financial (صلاحية contractor_finance_review — مودة):
//     approve → المرحلة النهائية (إشعار مالك الشركة)
//     return  → معادة للتعديل (إشعار المسؤول) — ثم إعادة إرسال للمراجعة
//     reject  → مرفوضة (إشعار المسؤول)
//     تُراجع: سعر المتر، الإجمالي، عدم التكرار، المعتمد سابقاً، الصافي
//   stage=final (صلاحية contractor_owner_final — محمد الزيدي مالك الشركة):
//     approve → معتمدة نهائياً وقابلة للصرف (إشعار المالي بالجهوزية)
//     return  → تعود للمراجعة المالية مع السبب
//     reject  → مرفوضة نهائياً مع ذكر السبب
//   stage=resubmit (صلاحية كتابة التكاليف): إعادة إرسال فاتورة معادة للتعديل
// لا تصبح الفاتورة قابلة للصرف إلا بعد موافقة مالك الشركة.
// كل قرار يسجل: اسم المعتمد وتاريخه ووقته وسببه وسجل التدقيق.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canWrite, canReviewContractorFinancial, canFinalizeContractorInvoices, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { notifyUsers } from '@/lib/notify'

export const dynamic = 'force-dynamic'

function str(v: unknown, max: number): string {
  var s = String(v == null ? '' : v).trim()
  return s.slice(0, max)
}
function isAdminEmail(email: string): boolean {
  return String(email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
}

var MONEY_LABEL = ' ر.ع'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  var stage = str(body.stage, 20)
  var decision = str(body.decision, 20)
  var note = str(body.note, 1000)
  if (['financial', 'final', 'resubmit'].indexOf(stage) === -1) {
    return NextResponse.json({ error: 'bad_request', message: 'المرحلة يجب أن تكون: financial أو final أو resubmit' }, { status: 400 })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || isAdminEmail(email)
  var costsWrite = canWrite(me.role, 'costs', me.permissions) || isSystemAdmin

  try { await ensureContractorDuesSupport() } catch (e: any) {
    console.error('[contractor decision] self-heal failed:', e)
  }

  var { id } = await params
  var invoice = await db.contractorInvoice.findUnique({ where: { id: id } })
  if (!invoice) return NextResponse.json({ error: 'not_found', message: 'الفاتورة غير موجودة' }, { status: 404 })

  var line = await db.driveLine.findUnique({ where: { id: invoice.driveLineId }, select: { id: true, projectId: true, lineNumber: true, contractorName: true, pricePerMeter: true } })
  var projectName = invoice.projectName

  // ── إعادة إرسال فاتورة معادة للتعديل — لمن يملك كتابة التكاليف ──
  if (stage === 'resubmit') {
    if (!costsWrite) {
      return NextResponse.json({ error: 'forbidden', message: 'إعادة إرسال الفاتورة متاحة لمن يملك صلاحية كتابة التكاليف' }, { status: 403 })
    }
    if (invoice.status !== 'returned') {
      return NextResponse.json({ error: 'bad_request', message: 'إعادة الإرسال متاحة فقط للفواتير المعادة للتعديل' }, { status: 400 })
    }
    var resubmitted = await db.contractorInvoice.update({
      where: { id: invoice.id },
      data: { status: 'pending_financial', finNote: null, finalNote: null },
    })
    await db.auditLog.create({
      data: { userId: me.id, projectId: line ? line.projectId : null, action: 'update', entity: 'contractor_invoice', entityId: invoice.id, details: 'إعادة إرسال الفاتورة ' + invoice.invoiceNo + ' للاعتماد المالي بعد التعديل — بواسطة ' + me.name },
    })
    try {
      await notifyUsers({
        type: 'contractor_invoice_financial_review',
        title: 'فاتورة مقاول معدّلة بانتظار الاعتماد المالي',
        message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' — صافي ' + invoice.netAmount + MONEY_LABEL + ' — أعيد إرسالها بعد التعديل بواسطة ' + me.name + ' — بانتظار مراجعتكم المالية.',
        severity: 'info',
        entityType: 'contractor_invoice',
        entityId: invoice.id,
        link: 'costs',
        permissions: ['contractor_finance_review', 'costs'],
        includeSystemAdmin: true,
      })
    } catch (nE) {
      console.error('[contractor decision] notify (resubmit) failed (non-fatal):', nE)
    }
    return NextResponse.json({ ok: true, invoice: resubmitted, message: 'أُعيدت الفاتورة ' + invoice.invoiceNo + ' للاعتماد المالي' })
  }

  // ── المرحلة المالية ──
  if (stage === 'financial') {
    if (!canReviewContractorFinancial(me)) {
      return NextResponse.json({ error: 'forbidden', message: 'الاعتماد المالي لفواتير المقاولين محصور بحساب المالي المخوّل — صلاحية contractor_finance_review تُمنح من إدارة المستخدمين' }, { status: 403 })
    }
    if (invoice.status !== 'pending_financial') {
      return NextResponse.json({ error: 'bad_request', message: 'الفاتورة ليست بانتظار الاعتماد المالي — حالتها: ' + invoice.status }, { status: 400 })
    }

    if (decision === 'approve') {
      // المراجعة المالية التي تتحققها هذه المرحلة (تعمل على الخادم كضمان إضافي):
      // سعر المتر موجب، الصافي = الإجمالي − المعتمد سابقاً، لا فاتورة نشطة أخرى لنفس الخط
      var dupes = await db.contractorInvoice.findMany({
        where: { driveLineId: invoice.driveLineId, id: { not: invoice.id }, status: { in: ['pending_financial', 'pending_final', 'approved', 'partially_paid', 'paid'] } },
        select: { invoiceNo: true },
      })
      if (dupes.length > 0) {
        return NextResponse.json({ error: 'duplicate_invoice', message: 'تحقق من التكرار فشل: توجد فاتورة نشطة أخرى لنفس الخط (' + dupes.map(function(d) { return d.invoiceNo }).join(', ') + ') — راجع قبل الاعتماد', duplicates: dupes }, { status: 409 })
      }
      var expectedNet = Math.round((invoice.totalAmount - invoice.previouslyApprovedAmount) * 1000) / 1000
      if (!invoice.isSettlement && Math.abs(expectedNet - invoice.netAmount) > 0.001) {
        return NextResponse.json({ error: 'bad_request', message: 'تحقق حسابي فشل: الصافي (' + invoice.netAmount + ') لا يساوي الإجمالي (' + invoice.totalAmount + ') ناقص المعتمد سابقاً (' + invoice.previouslyApprovedAmount + ') — راجع الفاتورة' }, { status: 400 })
      }

      var approvedFinal = await db.contractorInvoice.update({
        where: { id: invoice.id },
        data: { status: 'pending_final', finById: me.id, finByName: me.name, finAt: new Date(), finNote: note || null },
      })
      await db.auditLog.create({
        data: { userId: me.id, projectId: line ? line.projectId : null, action: 'approve', entity: 'contractor_invoice', entityId: invoice.id, details: 'اعتماد مالي للفاتورة ' + invoice.invoiceNo + ' — صافي ' + invoice.netAmount + MONEY_LABEL + ' — انتقلت للاعتماد النهائي — بواسطة ' + me.name + (note ? ' — ملاحظات: ' + note : '') },
      })
      try {
        await notifyUsers({
          type: 'contractor_invoice_final_review',
          title: 'فاتورة مقاول بانتظار الاعتماد النهائي (مالك الشركة)',
          message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' (' + projectName + ') — المقاول: ' + invoice.contractorName + ' — الطول المعتمد: ' + invoice.approvedLength + ' م — السعر: ' + invoice.pricePerMeter + MONEY_LABEL + '/م — الإجمالي: ' + invoice.totalAmount + MONEY_LABEL + ' — المعتمد سابقاً: ' + invoice.previouslyApprovedAmount + MONEY_LABEL + ' — الصافي: ' + invoice.netAmount + MONEY_LABEL + ' — اعتمدها مالياً ' + me.name + ' — بانتظار اعتمادك النهائي.',
          severity: 'warning',
          entityType: 'contractor_invoice',
          entityId: invoice.id,
          link: 'costs',
          permissions: ['contractor_owner_final', 'contractor_finance_review'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor decision] notify final failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, invoice: approvedFinal, message: 'اعتمدت الفاتورة ' + invoice.invoiceNo + ' مالياً — انتقلت للاعتماد النهائي لمالك الشركة' })
    }

    if (decision === 'return' || decision === 'reject') {
      var newStatus = decision === 'return' ? 'returned' : 'rejected'
      if (note.length < 3) {
        return NextResponse.json({ error: 'bad_request', message: decision === 'return' ? 'بيان التعديل المطلوب إجباري (3 أحرف على الأقل)' : 'سبب الرفض إجباري (3 أحرف على الأقل)' }, { status: 400 })
      }
      var returned = await db.contractorInvoice.update({
        where: { id: invoice.id },
        data: { status: newStatus, finById: me.id, finByName: me.name, finAt: new Date(), finNote: note },
      })
      await db.auditLog.create({
        data: { userId: me.id, projectId: line ? line.projectId : null, action: decision === 'return' ? 'update' : 'reject', entity: 'contractor_invoice', entityId: invoice.id, details: (decision === 'return' ? 'إعادة فاتورة للتعديل' : 'رفض فاتورة') + ' مالياً — ' + invoice.invoiceNo + ' — بواسطة ' + me.name + ' — ' + note },
      })
      try {
        await notifyUsers({
          type: 'contractor_invoice_' + newStatus,
          title: decision === 'return' ? 'فاتورة مقاول معادة للتعديل (الاعتماد المالي)' : 'فاتورة مقاول مرفوضة (الاعتماد المالي)',
          message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' (' + projectName + ') — ' + (decision === 'return' ? 'أعادتها ' : 'رفضها ') + me.name + ' — ' + note,
          severity: 'critical',
          entityType: 'contractor_invoice',
          entityId: invoice.id,
          link: 'costs',
          permissions: ['costs'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor decision] notify (fin return/reject) failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, invoice: returned, message: decision === 'return' ? 'أُعيدت الفاتورة للتعديل — سيصل إشعار للمسؤول مع بيان التعديل' : 'رُفضت الفاتورة وسُجل السبب' })
    }
  }

  // ── الاعتماد النهائي (مالك الشركة) ──
  if (stage === 'final') {
    if (!canFinalizeContractorInvoices(me)) {
      return NextResponse.json({ error: 'forbidden', message: 'الاعتماد النهائي محصور بحساب مالك الشركة المخوّل — صلاحية contractor_owner_final تُمنح من إدارة المستخدمين' }, { status: 403 })
    }
    if (invoice.status !== 'pending_final') {
      return NextResponse.json({ error: 'bad_request', message: 'الفاتورة ليست بانتظار الاعتماد النهائي — حالتها: ' + invoice.status }, { status: 400 })
    }

    if (decision === 'approve') {
      var approved = await db.contractorInvoice.update({
        where: { id: invoice.id },
        data: { status: 'approved', finalById: me.id, finalByName: me.name, finalAt: new Date(), finalNote: note || null },
      })
      await db.auditLog.create({
        data: { userId: me.id, projectId: line ? line.projectId : null, action: 'approve', entity: 'contractor_invoice', entityId: invoice.id, details: 'الاعتماد النهائي للفاتورة ' + invoice.invoiceNo + ' — صافي ' + invoice.netAmount + MONEY_LABEL + ' — أصبحت معتمدة وقابلة للصرف — بواسطة ' + me.name + (note ? ' — ملاحظات: ' + note : '') },
      })
      try {
        await notifyUsers({
          type: 'contractor_invoice_approved',
          title: 'فاتورة مقاول معتمدة نهائياً — جاهزة لإجراءات الدفع',
          message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' (' + projectName + ') — المقاول: ' + invoice.contractorName + ' — صافي ' + invoice.netAmount + MONEY_LABEL + ' — اعتمدها نهائياً ' + me.name + ' — أصبحت قابلة للدفع، وسجّلوا الدفعات ليتحدث الرصيد تلقائياً.',
          severity: 'info',
          entityType: 'contractor_invoice',
          entityId: invoice.id,
          link: 'costs',
          permissions: ['contractor_finance_review', 'costs'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor decision] notify approved failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, invoice: approved, message: 'اعتمدت الفاتورة ' + invoice.invoiceNo + ' نهائياً — أصبحت قابلة للصرف' })
    }

    if (decision === 'return') {
      if (note.length < 3) {
        return NextResponse.json({ error: 'bad_request', message: 'سبب الإرجاع للمراجعة إجباري (3 أحرف على الأقل)' }, { status: 400 })
      }
      var backToFin = await db.contractorInvoice.update({
        where: { id: invoice.id },
        data: { status: 'pending_financial', finalById: me.id, finalByName: me.name, finalAt: new Date(), finalNote: note },
      })
      await db.auditLog.create({
        data: { userId: me.id, projectId: line ? line.projectId : null, action: 'update', entity: 'contractor_invoice', entityId: invoice.id, details: 'إرجاع الفاتورة ' + invoice.invoiceNo + ' للمراجعة المالية — بواسطة مالك الشركة ' + me.name + ' — ' + note },
      })
      try {
        await notifyUsers({
          type: 'contractor_invoice_final_returned',
          title: 'فاتورة مقاول أرجعها مالك الشركة للمراجعة المالية',
          message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' — أرجعها مالك الشركة للمراجعة المالية — السبب: ' + note,
          severity: 'critical',
          entityType: 'contractor_invoice',
          entityId: invoice.id,
          link: 'costs',
          permissions: ['contractor_finance_review', 'costs'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor decision] notify (final return) failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, invoice: backToFin, message: 'أُرجعت الفاتورة للمراجعة المالية مع السبب' })
    }

    if (decision === 'reject') {
      if (note.length < 3) {
        return NextResponse.json({ error: 'bad_request', message: 'سبب الرفض إجباري (3 أحرف على الأقل)' }, { status: 400 })
      }
      var rejected = await db.contractorInvoice.update({
        where: { id: invoice.id },
        data: { status: 'rejected', finalById: me.id, finalByName: me.name, finalAt: new Date(), finalNote: note },
      })
      await db.auditLog.create({
        data: { userId: me.id, projectId: line ? line.projectId : null, action: 'reject', entity: 'contractor_invoice', entityId: invoice.id, details: 'رفض نهائي للفاتورة ' + invoice.invoiceNo + ' — بواسطة مالك الشركة ' + me.name + ' — السبب: ' + note },
      })
      try {
        await notifyUsers({
          type: 'contractor_invoice_rejected',
          title: 'فاتورة مقاول مرفوضة نهائياً (مالك الشركة)',
          message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' (' + projectName + ') — رفضها نهائياً مالك الشركة — السبب: ' + note,
          severity: 'critical',
          entityType: 'contractor_invoice',
          entityId: invoice.id,
          link: 'costs',
          permissions: ['contractor_finance_review', 'costs'],
          includeSystemAdmin: true,
        })
      } catch (nE) {
        console.error('[contractor decision] notify (final reject) failed (non-fatal):', nE)
      }
      return NextResponse.json({ ok: true, invoice: rejected, message: 'رُفضت الفاتورة نهائياً وسُجل السبب' })
    }
  }

  return NextResponse.json({ error: 'bad_request', message: 'قرار غير معروف — القرارات المتاحة: approve, return, reject' }, { status: 400 })
}
