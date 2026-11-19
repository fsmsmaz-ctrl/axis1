// ============================================================
// v123 — فاتورة تسوية مالية مستقلة (استثناء مصرّح به فقط)
// AXIS Pipe Jacking Management System
// ============================================================
// POST /api/contractor-dues/invoices/create-settlement
// المواصفة (منع التكرار، بند 5): «لا يُسمح بإنشاء فاتورة ثانية لخط
// مكتمل ومعتمد إلا من خلال إجراء تسوية مالية مستقل ومصرّح به».
// هذا المسار هو الإجراء الوحيد المصرّح به:
//   • الصلاحية: مالك الشركة (contractor_owner_final) أو مدير النظام — من الخادم.
//   • السبب إجباري ويُوثق في الفاتورة وسجل التدقيق.
//   • الطول المطلوب تسويته لا يتجاوز غير المسوى (منع الازدواجية).
//   • الفاتورة الناتجة تدخل دورة الاعتماد نفسها (مالي ← نهائي).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { canFinalizeContractorInvoices, SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { createDraftInvoiceForLine, round3 } from '@/lib/contractor-dues'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'

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

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  var email = String(me.email || '').toLowerCase().trim()
  var isSystemAdmin = me.isSystemAdmin === true || isAdminEmail(email)
  if (!canFinalizeContractorInvoices(me) && !isSystemAdmin) {
    return NextResponse.json({ error: 'forbidden', message: 'التسوية المالية المستقلة محصورة بحساب مالك الشركة المخوّل أو مدير النظام' }, { status: 403 })
  }

  var body: any = null
  try { body = await req.json() } catch { body = null }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad_request', message: 'طلب غير صالح' }, { status: 400 })
  }

  var driveLineId = str(body.driveLineId, 64)
  var settlementLength = round3(num(body.settlementLength))
  var reason = str(body.reason, 500)
  if (!driveLineId) return NextResponse.json({ error: 'bad_request', message: 'معرف خط الحفر مطلوب' }, { status: 400 })
  if (!(settlementLength > 0)) return NextResponse.json({ error: 'bad_request', message: 'الطول المطلوب تسويته يجب أن يكون رقماً موجباً' }, { status: 400 })
  if (reason.length < 3) return NextResponse.json({ error: 'bad_request', message: 'سبب التسوية إجباري (3 أحرف على الأقل) — لا فاتورة ثانية إلا بإجراء موثق' }, { status: 400 })

  try { await ensureContractorDuesSupport() } catch (e: any) {
    console.error('[contractor settlement] self-heal failed:', e)
  }

  // منع الازدواجية: الطول المطلوب لا يتجاوز غير المسوى على الخط
  var agg = await db.dailyReport.aggregate({
    where: { driveLineId: driveLineId, status: 'approved' },
    _sum: { dailyMeters: true },
  })
  var excavated = round3(Math.max(0, Number(agg._sum.dailyMeters) || 0))
  var line = await db.driveLine.findUnique({ where: { id: driveLineId }, select: { id: true, lineNumber: true, settledOldLength: true, settledOldAmount: true } })
  if (!line) return NextResponse.json({ error: 'not_found', message: 'خط الحفر غير موجود' }, { status: 404 })
  var settledInvoices = await db.contractorInvoice.findMany({
    where: { driveLineId: driveLineId, status: { in: ['approved', 'partially_paid', 'paid'] } },
    select: { approvedLength: true },
  })
  var newInvoiced = 0
  for (var inv of settledInvoices) newInvoiced += Number(inv.approvedLength) || 0
  var unsettled = round3(Math.max(0, excavated - (Number(line.settledOldLength) || 0) - newInvoiced))
  if (settlementLength > unsettled + 0.001) {
    return NextResponse.json({ error: 'duplicate', message: 'الطول المطلوب (' + settlementLength + ' م) يتجاوز غير المسوى (' + unsettled + ' م) — منع الازدواجية: لا احتساب لأطوال سبق اعتمادها' }, { status: 409 })
  }

  var result = await createDraftInvoiceForLine(driveLineId, { id: me.id, name: me.name }, { isSettlement: true, reason: reason, settlementLength: settlementLength })
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'error', message: result.message || 'فشل إنشاء التسوية' }, { status: result.status || 500 })
  }

  return NextResponse.json({ ok: true, invoice: result.invoice, message: 'أُنشئت فاتورة التسوية ' + result.invoice.invoiceNo + ' بصافي ' + result.invoice.netAmount + ' ر.ع — تدخل دورة الاعتماد المالية فالنهائية' })
}
