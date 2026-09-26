// v48: إدارة عملية شراء واحدة من الملف الشخصي
// PATCH: تعديل مسودة خاصة بالموظف (قبل التسليم فقط)
// DELETE: حذف مسودة خاصة بالموظف
// POST: تسليم المسودة للمراجعة — يشترط وجود صورة الفاتورة (شرط المستخدم)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { parseNumber } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { notifyUsers } from '@/lib/notify'
import { ensurePurchasesSupport } from '@/lib/db-selfheal'
import { logProfileAudit, logOversightEvent } from '@/lib/profile-audit'

var MAX_INVOICE_CHARS = 6000000

function validInvoiceImage(s: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/.test(s) && s.length <= MAX_INVOICE_CHARS
}

function statusMessage(status: string, isOwnerAr: boolean): string {
  // رسالة الخطأ عندما تكون العملية ليست مسودة
  return isOwnerAr
    ? 'لا يمكن التعديل أو الحذف بعد التسليم — العملية قيد المراجعة أو مُراجعة'
    : 'Cannot modify after submission'
}

// PATCH: تعديل مسودة
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensurePurchasesSupport()
    var { id } = await params
    var body = await req.json()
    var purchase = await db.purchase.findUnique({ where: { id: String(id) } })
    if (!purchase || purchase.userId !== user.id) {
      return NextResponse.json({ error: 'not_found', message: 'عملية الشراء غير موجودة' }, { status: 404 })
    }
    if (purchase.status !== 'draft') {
      return NextResponse.json({ error: 'locked', message: statusMessage(purchase.status, true) }, { status: 400 })
    }

    var data: any = {}
    if ('title' in body) {
      var title = String(body.title).trim()
      if (!title) {
        return NextResponse.json({ error: 'invalid_input', message: 'أدخل اسم الغرض المشترى' }, { status: 400 })
      }
      data.title = title.slice(0, 300)
    }
    if ('amount' in body) {
      var amount = parseNumber(body.amount, NaN)
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
        return NextResponse.json({ error: 'invalid_amount', message: 'المبلغ يجب أن يكون رقماً موجباً ومعقولاً' }, { status: 400 })
      }
      data.amount = amount
    }
    if ('notes' in body) {
      data.notes = body.notes ? String(body.notes).slice(0, 2000) : null
    }
    if ('invoiceImage' in body && body.invoiceImage) {
      var img = String(body.invoiceImage)
      if (!validInvoiceImage(img)) {
        return NextResponse.json({ error: 'invalid_input', message: 'صورة الفاتورة غير صالحة أو حجمها كبير جداً' }, { status: 400 })
      }
      data.invoiceImage = img
    }
    var updated = await db.purchase.update({ where: { id: purchase.id }, data })
    // v49: تعديل مسودة المشتريات يُسجل في الرقابة — سجل عمليات
    await logProfileAudit({
      actorId: user.id, action: 'update', entity: 'purchase', entityId: purchase.id,
      details: JSON.stringify({
        summary: 'تعديل مسودة عملية شراء «' + (updated.title || purchase.title) + '»',
        changes: [],
      }),
    })
    return NextResponse.json({ ok: true, purchase: updated })
  } catch (e) {
    console.error('v48 purchase PATCH failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل تعديل عملية الشراء' }, { status: 500 })
  }
}

// DELETE: حذف مسودة
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  try {
    await ensurePurchasesSupport()
    var { id } = await params
    var purchase = await db.purchase.findUnique({ where: { id: String(id) } })
    if (!purchase || purchase.userId !== user.id) {
      return NextResponse.json({ error: 'not_found', message: 'عملية الشراء غير موجودة' }, { status: 404 })
    }
    if (purchase.status !== 'draft') {
      return NextResponse.json({ error: 'locked', message: statusMessage(purchase.status, true) }, { status: 400 })
    }
    await db.purchase.delete({ where: { id: purchase.id } })
    // v49: حذف مسودة المشتريات يُسجل في الرقابة — سجل عمليات + تنبيه رقابي عام
    await logProfileAudit({
      actorId: user.id, action: 'delete', entity: 'purchase', entityId: purchase.id,
      details: JSON.stringify({
        summary: 'حذف مسودة عملية شراء «' + purchase.title + '»',
        changes: [{ field: 'المبلغ', fieldEn: 'Amount', old: '', new: purchase.amount + ' ر.ع' }],
      }),
    })
    await logOversightEvent({
      type: 'purchase_log',
      title: 'نشاط مشتريات — حذف',
      message: (user.name || 'موظف') + ' حذف مسودة عملية شراء «' + purchase.title + '»',
      severity: 'info',
      link: 'profile', entityType: 'purchase', entityId: purchase.id,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('v48 purchase DELETE failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل حذف عملية الشراء' }, { status: 500 })
  }
}

// POST: تسليم المسودة للمراجعة — يشترط صورة الفاتورة
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensurePurchasesSupport()
    var { id } = await params
    var purchase = await db.purchase.findUnique({ where: { id: String(id) } })
    if (!purchase || purchase.userId !== user.id) {
      return NextResponse.json({ error: 'not_found', message: 'عملية الشراء غير موجودة' }, { status: 404 })
    }
    if (purchase.status !== 'draft') {
      return NextResponse.json({ error: 'already_submitted', message: 'تم تسليم هذه الفاتورة مسبقاً' }, { status: 400 })
    }
    if (!purchase.invoiceImage) {
      return NextResponse.json({ error: 'missing_invoice', message: 'صورة الفاتورة مطلوبة قبل التسليم' }, { status: 400 })
    }
    var updated = await db.purchase.update({
      where: { id: purchase.id },
      data: { status: 'submitted', submittedAt: new Date() },
    })
    // v49: تسليم الفاتورة يُسجل في الرقابة — سجل عمليات + تنبيه رقابي عام لكل مشاهدي الرقابة
    await logProfileAudit({
      actorId: user.id, action: 'submit', entity: 'purchase', entityId: purchase.id,
      details: JSON.stringify({
        summary: 'تسليم فاتورة «' + purchase.title + '» للمراجعة',
        changes: [{ field: 'الحالة', fieldEn: 'Status', old: 'مسودة', new: 'مقدمة للمراجعة' }],
      }),
    })
    await logOversightEvent({
      type: 'purchase_log',
      title: 'نشاط مشتريات — تسليم للمراجعة',
      message: (user.name || 'موظف') + ' سلّم فاتورة «' + purchase.title + '» بمبلغ ' + purchase.amount + ' ر.ع — بانتظار المراجعة والاعتماد',
      severity: 'info',
      link: 'dashboard', entityType: 'purchase', entityId: purchase.id,
    })
    // تنبيه المراجعين: الإدارة العليا + مدير النظام
    try {
      await notifyUsers({
        type: 'purchase_submitted',
        title: 'فاتورة مشتريات جديدة',
        message: (user.name || 'موظف') + ' سلّم فاتورة شراء «' + purchase.title + '» بمبلغ ' + purchase.amount + ' ر.ع — بانتظار المراجعة',
        severity: 'info',
        link: 'dashboard',
        permissions: [],
        roles: ['top_management'],
        includeSystemAdmin: true,
      })
    } catch (notifyErr) {
      console.warn('v48 purchase submit notify skipped:', notifyErr)
    }
    return NextResponse.json({ ok: true, purchase: updated })
  } catch (e) {
    console.error('v48 purchase submit failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل تسليم الفاتورة' }, { status: 500 })
  }
}
