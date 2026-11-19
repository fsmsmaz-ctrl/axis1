// ============================================================
// v123 — دفعات فاتورة المقاول المعتمدة
// AXIS Pipe Jacking Management System
// ============================================================
// POST /api/contractor-dues/invoices/[id]/payments
//   تسجيل دفعة على فاتورة معتمدة (approved أو partially_paid فقط —
//   لا دفع على فاتورة لم ياعتمدها مالك الشركة).
//   يعيد النظام حساب حالة الفاتورة آلياً: partially_paid / paid،
//   ويسجل اسم الدافع وتاريخ ووقت الدفع، ويشعر أصحاب الصلاحية،
//   ويكتب سجل التدقيق. لا دفعة تتجاوز الصافي — لا دفع زائد.
// الصلاحية: contractor_finance_review أو مدير النظام — من الخادم.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canReviewContractorFinancial, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { round3 } from '@/lib/contractor-dues'
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

var MONEY_LABEL = ' ر.ع'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  if (!canReviewContractorFinancial(me)) {
    return NextResponse.json({ error: 'forbidden', message: 'تسجيل الدفعات محصور بحساب الاعتماد المالي أو مدير النظام' }, { status: 403 })
  }

  var body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad_request', message: 'طلب غير صالح' }, { status: 400 })
  }

  var amount = round3(num(body.amount))
  var note = str(body.note, 300)
  var paidAt: Date
  if (body.paidAt && String(body.paidAt).trim() !== '') {
    paidAt = new Date(String(body.paidAt).trim())
    if (isNaN(paidAt.getTime())) paidAt = new Date()
  } else {
    paidAt = new Date()
  }

  if (amount <= 0 || amount > 10000000) {
    return NextResponse.json({ error: 'bad_request', message: 'مبلغ الدفعة يجب أن يكون رقماً موجباً منطقياً' }, { status: 400 })
  }

  try { await ensureContractorDuesSupport() } catch (e: any) {
    console.error('[contractor payment] self-heal failed:', e)
  }

  var { id } = await params
  var invoice = await db.contractorInvoice.findUnique({
    where: { id: id },
    include: { payments: true },
  })
  if (!invoice) return NextResponse.json({ error: 'not_found', message: 'الفاتورة غير موجودة' }, { status: 404 })
  if (['approved', 'partially_paid'].indexOf(invoice.status) === -1) {
    return NextResponse.json({ error: 'bad_request', message: 'الدفع متاح فقط على الفواتير المعتمدة نهائياً — حالة هذه الفاتورة: ' + invoice.status }, { status: 400 })
  }

  var paidSoFar = 0
  for (var p of invoice.payments) paidSoFar += Number(p.amount) || 0
  var remaining = round3(invoice.netAmount - paidSoFar)
  if (amount > remaining + 0.001) {
    return NextResponse.json({ error: 'bad_request', message: 'الدفعة تتجاوز الصافي المتبقي (' + remaining + MONEY_LABEL + ') — لا دفع زائد على الفاتورة' }, { status: 400 })
  }

  var payment = await db.contractorInvoicePayment.create({
    data: {
      invoiceId: invoice.id,
      amount: amount,
      paidAt: paidAt,
      note: note || null,
      byId: me.id,
      byName: me.name,
    },
  })

  var newPaidTotal = round3(paidSoFar + amount)
  var newStatus = newPaidTotal >= invoice.netAmount - 0.001 ? 'paid' : 'partially_paid'
  var updated = await db.contractorInvoice.update({
    where: { id: invoice.id },
    data: { status: newStatus },
  })

  await db.auditLog.create({
    data: {
      userId: me.id,
      action: 'create',
      entity: 'contractor_invoice_payment',
      entityId: payment.id,
      details: 'دفعة على فاتورة المقاول ' + invoice.invoiceNo + ' — مبلغ ' + amount + MONEY_LABEL + ' بتاريخ ' + paidAt.toISOString().slice(0, 10) + ' — بواسطة ' + me.name + ' — الإجمالي المدفوع: ' + newPaidTotal + MONEY_LABEL + ' من ' + invoice.netAmount + MONEY_LABEL + ' — الحالة: ' + newStatus + (note ? ' — ملاحظة: ' + note : ''),
    },
  })

  try {
    await notifyUsers({
      type: 'contractor_invoice_payment',
      title: newStatus === 'paid' ? 'فاتورة مقاول سُددت بالكامل' : 'دفعة جديدة على فاتورة مقاول',
      message: 'الفاتورة ' + invoice.invoiceNo + ' — الخط ' + invoice.lineNumber + ' (' + invoice.projectName + ') — المقاول: ' + invoice.contractorName + ' — دفعة ' + amount + MONEY_LABEL + ' سجلها ' + me.name + ' — المدفوع: ' + newPaidTotal + MONEY_LABEL + ' من ' + invoice.netAmount + MONEY_LABEL + ' — المتبقي: ' + round3(invoice.netAmount - newPaidTotal) + MONEY_LABEL,
      severity: 'info',
      entityType: 'contractor_invoice',
      entityId: invoice.id,
      link: 'costs',
      permissions: ['contractor_finance_review', 'contractor_owner_final', 'costs'],
      includeSystemAdmin: true,
    })
  } catch (nE) {
    console.error('[contractor payment] notify failed (non-fatal):', nE)
  }

  return NextResponse.json({ ok: true, payment: payment, invoice: updated, message: 'سُجلت الدفعة ' + amount + MONEY_LABEL + ' — الحالة الآن: ' + (newStatus === 'paid' ? 'مدفوعة بالكامل' : 'مدفوعة جزئياً') + ' — المتبقي ' + round3(invoice.netAmount - newPaidTotal) + MONEY_LABEL })
}
