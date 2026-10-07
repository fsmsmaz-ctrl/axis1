// v48: مشتريات الموظف من الملف الشخصي
// GET: قائمة مشتريات المستخدم الحالي (بكل الحالات)
// POST: إنشاء عملية شراء جديدة — صورة الفاتورة إلزامية (شرط المستخدم)
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { validateRequired, parseNumber } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensurePurchasesSupport } from '@/lib/db-selfheal'
import { logProfileAudit, logOversightEvent } from '@/lib/profile-audit'

// ~4.5MB صورة base64 بعد الضغط في المتصفح (فاتورة كاملة بدقة جيدة)
var MAX_INVOICE_CHARS = 6000000

function validInvoiceImage(s: string): boolean {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/.test(s) && s.length <= MAX_INVOICE_CHARS
}

// GET: مشتريات المستخدم الحالي مرتبة من الأحدث
// v73: إصلاح قنبلة الحمولة — القائمة كانت تُرسل invoiceImage (حتى 4.5MB لكل فاتورة)
// لكل السجلات المئة في كل زيارة للملف الشخصي فتتجمد الصفحة على الأجهزة الضعيفة
// وتنفق بيانات الجوال. الآن: القائمة خفيفة بلا صور + علم hasInvoice، والصورة
// تُجلب عند الطلب من GET /api/purchases/[id] (عرض الفاتورة أو تعديل المسودة)
export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  try {
    await ensurePurchasesSupport()
    var rows = await db.purchase.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      // v70: حد أقصى للحمولة — السجل الكامل مع صور الفواتير قد يبلغ مئات الميغابايت
      take: 100,
      // v73: بلا invoiceImage — العمود الثقيل يبقى في القاعدة ويُجلب عند الطلب
      select: {
        id: true, title: true, notes: true, amount: true,
        status: true, projectId: true, reviewNote: true,
        reviewedById: true, reviewedAt: true, costId: true,
        submittedAt: true, createdAt: true, updatedAt: true,
        project: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true, nameEn: true } },
      },
    })
    // v73: أيّ السجلات تملك صورة فاتورة؟ — استعلام خفيف بالمعرفات فقط
    var imgRows = await db.purchase.findMany({
      where: { userId: user.id, id: { in: rows.map(function(p) { return p.id }) }, invoiceImage: { not: null } },
      select: { id: true },
    })
    var imgSet = new Set(imgRows.map(function(r) { return r.id }))
    var purchases = rows.map(function(p) {
      return Object.assign({}, p, { hasInvoice: imgSet.has(p.id) })
    })
    return NextResponse.json({ purchases })
  } catch (e) {
    console.error('v48 purchases GET failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل جلب المشتريات' }, { status: 500 })
  }
}

// POST: إنشاء عملية شراء جديدة (مسودة بصورة فاتورة إلزامية)
export async function POST(req: NextRequest) {
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
    var body = await req.json()
    var validationError = validateRequired(body, ['title', 'amount', 'invoiceImage'])
    if (validationError) return validationError

    var title = String(body.title).trim()
    if (!title) {
      return NextResponse.json({ error: 'invalid_input', message: 'أدخل اسم الغرض المشترى' }, { status: 400 })
    }
    var amount = parseNumber(body.amount, NaN)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      return NextResponse.json({ error: 'invalid_amount', message: 'المبلغ يجب أن يكون رقماً موجباً ومعقولاً (أقل من 10,000,000)' }, { status: 400 })
    }
    var invoiceImage = String(body.invoiceImage)
    if (!validInvoiceImage(invoiceImage)) {
      return NextResponse.json({ error: 'invalid_input', message: 'صورة الفاتورة غير صالحة أو حجمها كبير جداً' }, { status: 400 })
    }

    var purchase = await db.purchase.create({
      data: {
        userId: user.id,
        title: title.slice(0, 300),
        notes: body.notes ? String(body.notes).slice(0, 2000) : null,
        amount: amount,
        invoiceImage: invoiceImage,
        projectId: body.projectId ? String(body.projectId) : null,
        status: 'draft',
      },
    })
    // v49: ربط إضافة المشتريات بالرقابة — سجل عمليات + تنبيه رقابي عام
    await logProfileAudit({
      actorId: user.id, action: 'create', entity: 'purchase', entityId: purchase.id,
      details: JSON.stringify({
        summary: 'إضافة عملية شراء «' + purchase.title + '» (مسودة)',
        changes: [{ field: 'المبلغ', fieldEn: 'Amount', old: '', new: purchase.amount + ' ر.ع' }],
      }),
    })
    await logOversightEvent({
      type: 'purchase_log',
      title: 'نشاط مشتريات — إضافة',
      message: (user.name || 'موظف') + ' أضاف عملية شراء «' + purchase.title + '» بمبلغ ' + purchase.amount + ' ر.ع (مسودة — لم تُسلَّم للمراجعة بعد)',
      severity: 'info',
      link: 'profile', entityType: 'purchase', entityId: purchase.id,
    })
    return NextResponse.json({ ok: true, purchase })
  } catch (e) {
    console.error('v48 purchases POST failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل إنشاء عملية الشراء' }, { status: 500 })
  }
}
