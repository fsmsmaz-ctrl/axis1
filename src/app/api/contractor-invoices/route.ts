// ============================================================
// v116 — فواتير المقاول: النافذة المنبثقة + الاعتماد اليدوي
// ============================================================
// GET  /api/contractor-invoices — مقترحات الفواتير بانتظار الموافقة.
//      النظام ولّدها لكل 10 أمتار من كل خط حفر (شاملة الخطوط
//      القديمة والمنتهية) لكنه لم يسجلها — تُعرض في نافذة منبثقة
//      خاصة بقسم الإيرادات والتكاليف ليدخل الموظف السعر يدوياً.
//      قبل الجلب يعمل التنظيف الرجعي الذي يحذف فواتير v114 الآلية.
// POST /api/contractor-invoices — اعتماد فاتورة: يقرأ الموظف
//      المقترح ويدخل السعر يدوياً ويوافق، وبعد الموافقة فقط تُسجَّل
//      ضمن الفواتير في القسم (بدل التسجيل الآلي في v114).
//
// الصلاحيات: القراءة ببوابة قراءة التكاليف نفسها، والاعتماد بصلاحية
// كتابة التكاليف نفسها (الإدارة والمدير المالي والإداري) — أي خلل
// داخلي لا يمنع عمل بقية الصفحات أبداً.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { hasPermission, canWrite } from '@/lib/auth'
import { parseNumber } from '@/lib/api-helpers'
import { listPendingContractorInvoices, maintainContractorInvoices, approveContractorInvoice } from '@/lib/contractor-invoices'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // نفس بوابة قراءة التكاليف في /api/costs (تشمل صلاحيات التقارير المالية)
  var canReadCosts = hasPermission(user.role, 'costs', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_costs', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_revenue', user.permissions, user.email)
    || hasPermission(user.role, 'rpt_profit', user.permissions, user.email)
  if (!canReadCosts) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض التكاليف والإيرادات' }, { status: 403 })
  }

  // v116: التنظيف الرجعي لفواتير v114 الآلية يعمل هنا أيضاً (مُقيَّد زمنياً داخلياً)
  try {
    await maintainContractorInvoices()
  } catch (e) {
    console.error('[contractor-invoices GET] maintenance failed (non-fatal):', e)
  }

  var result = await listPendingContractorInvoices()
  return NextResponse.json({
    pending: result.pending,
    count: result.count,
    truncated: result.truncated,
    linesChecked: result.linesChecked,
    skippedNoPrice: result.skippedNoPrice,
    error: result.error || null,
  })
}

export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY نفس بوابة كتابة التكاليف في /api/costs POST
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'اعتماد فواتير المقاول متاح للإدارة والمدير المالي والإداري فقط' }, { status: 403 })
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var body = await req.json().catch(function() { return null as any })
    var token = String((body && body.token) || '')
    if (!token) {
      return NextResponse.json({ error: 'invalid_token', message: 'بطاقة الفاتورة مفقودة — حدث القائمة وأعد المحاولة' }, { status: 400 })
    }
    var amount = parseNumber(body ? body.amount : NaN, NaN)
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: 'invalid_amount', message: 'أدخل السعر يدوياً كرقماً موجباً' }, { status: 400 })
    }

    var res = await approveContractorInvoice({ token: token, amount: amount, userId: user.id })
    if (!res.ok) {
      return NextResponse.json(
        { error: 'approve_failed', message: res.message || 'تعذر تسجيل الفاتورة', duplicate: !!res.duplicate, expired: !!res.expired },
        { status: 400 }
      )
    }
    return NextResponse.json({ success: true, duplicate: !!res.duplicate, costId: res.costId || null })
  } catch (error: any) {
    console.error('[contractor-invoices POST] failed:', error)
    return NextResponse.json({ error: 'server_error', message: 'تعذر تسجيل الفاتورة — أعد المحاولة' }, { status: 500 })
  }
}
