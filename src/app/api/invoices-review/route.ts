// v48: مراجعة فواتير المشتريات — قسم جديد في لوحة التحكم
// GET: الفواتير المرسلة (+ سجل المراجعة) — للإدارة العليا ومدير النظام فقط
// POST: اعتماد أو رفض — الاعتماد يسجل الفاتورة تلقائياً في جدول التكاليف ويربطها بها
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensurePurchasesSupport } from '@/lib/db-selfheal'
import { logProfileAudit, logOversightEvent } from '@/lib/profile-audit'

// نفس تصنيفات التكاليف المعتمدة في /api/costs
var COST_CATEGORIES = ['labor', 'housing', 'transport', 'fuel', 'maintenance', 'parts', 'oil', 'safety', 'rental', 'other']

function canReview(user: { role: string; isSystemAdmin?: boolean }): boolean {
  return user.role === 'top_management' || user.isSystemAdmin === true
}

// GET: قائمة الفواتير غير المسودات — المرسلة أولاً ثم سجل المراجعة
export async function GET(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!canReview(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'مراجعة الفواتير متاحة للإدارة العليا ومدير النظام فقط' }, { status: 403 })
  }
  try {
    await ensurePurchasesSupport()
    var purchases = await db.purchase.findMany({
      where: { status: { not: 'draft' } },
      orderBy: { submittedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, nameEn: true, role: true } },
        project: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true, nameEn: true } },
        cost: { select: { id: true, category: true } },
      },
    })
    // المرسلة أولاً ثم المعتمدة/المرفوضة
    purchases.sort(function(a, b) {
      var rank = function(s: string) { return s === 'submitted' ? 0 : 1 }
      return rank(a.status) - rank(b.status)
    })
    return NextResponse.json({ purchases })
  } catch (e) {
    console.error('v48 invoices-review GET failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل جلب الفواتير' }, { status: 500 })
  }
}

// POST: اعتماد أو رفض فاتورة
export async function POST(req: NextRequest) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!canReview(user)) {
    return NextResponse.json({ error: 'forbidden', message: 'مراجعة الفواتير متاحة للإدارة العليا ومدير النظام فقط' }, { status: 403 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensurePurchasesSupport()
    var body = await req.json()
    var id = body.id ? String(body.id) : ''
    var action = body.action ? String(body.action) : ''
    if (!id || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json({ error: 'invalid_input', message: 'بيانات المراجعة ناقصة' }, { status: 400 })
    }
    var purchase = await db.purchase.findUnique({ where: { id: id } })
    if (!purchase) {
      return NextResponse.json({ error: 'not_found', message: 'الفاتورة غير موجودة' }, { status: 404 })
    }
    if (purchase.status !== 'submitted') {
      return NextResponse.json({ error: 'already_reviewed', message: 'تمت مراجعة هذه الفاتورة مسبقاً' }, { status: 400 })
    }
    var note = body.note ? String(body.note).slice(0, 1000) : null

    // ── الرفض: تسجيل الحالة + تنبيه الموظف ──
    if (action === 'reject') {
      var rejected = await db.purchase.update({
        where: { id: purchase.id },
        data: { status: 'rejected', reviewNote: note, reviewedById: user.id, reviewedAt: new Date() },
      })
      try {
        await db.notification.create({
          data: {
            userId: purchase.userId,
            type: 'purchase_reviewed',
            title: 'تم رفض فاتورة الشراء',
            message: 'رُفضت فاتورة «' + purchase.title + '»' + (note ? ' — السبب: ' + note : ''),
            severity: 'warning',
            link: 'profile',
            entityType: 'purchase',
            entityId: purchase.id,
          },
        })
      } catch (notifyErr) {
        console.warn('v48 reject notify skipped:', notifyErr)
      }
      // v49: الرفض يُسجل في الرقابة — سجل عمليات + تنبيه رقابي عام
      await logProfileAudit({
        actorId: user.id, action: 'reject', entity: 'purchase', entityId: purchase.id,
        details: JSON.stringify({
          summary: 'رفض فاتورة «' + purchase.title + '»',
          changes: [{ field: 'الحالة', fieldEn: 'Status', old: 'مقدمة للمراجعة', new: 'مرفوضة' }],
        }),
      })
      await logOversightEvent({
        type: 'purchase_log',
        title: 'نشاط مشتريات — رفض',
        message: (user.name || 'مراجع') + ' رفض فاتورة «' + purchase.title + '»' + (note ? ' — السبب: ' + note : ''),
        severity: 'warning',
        link: 'dashboard', entityType: 'purchase', entityId: purchase.id,
      })
      return NextResponse.json({ ok: true, purchase: rejected })
    }

    // ── الاعتماد: تسجيل تلقائي في التكاليف + ربط + تنبيه الموظف ──
    if (purchase.costId) {
      return NextResponse.json({ error: 'already_recorded', message: 'هذه الفاتورة مسجلة في التكاليف مسبقاً' }, { status: 400 })
    }
    var category = body.category ? String(body.category) : 'other'
    if (COST_CATEGORIES.indexOf(category) === -1) category = 'other'
    // المشروع: يختاره المراجع عند الاعتماد (اختياري) — وإلا يبقى «بدون مشروع»
    var projectId = body.projectId ? String(body.projectId) : (purchase.projectId || null)

    var cost = await db.cost.create({
      data: {
        projectId: projectId,
        date: new Date(),
        category: category,
        description: ('شراء: ' + purchase.title).slice(0, 1000),
        amount: purchase.amount,
        notes: ('فاتورة مشتريات معتمدة — سُجلت تلقائياً من مراجعة الفواتير').slice(0, 2000),
        recordedById: user.id,
      },
    })
    var approved = await db.purchase.update({
      where: { id: purchase.id },
      data: { status: 'approved', reviewNote: note, reviewedById: user.id, reviewedAt: new Date(), costId: cost.id },
    })
    try {
      await db.notification.create({
        data: {
          userId: purchase.userId,
          type: 'purchase_reviewed',
          title: 'تم اعتماد فاتورة الشراء',
          message: 'اعتُمدت فاتورة «' + purchase.title + '» بمبلغ ' + purchase.amount + ' ر.ع وسُجلت في التكاليف تلقائياً',
          severity: 'info',
          link: 'profile',
          entityType: 'purchase',
          entityId: purchase.id,
        },
      })
    } catch (notifyErr) {
      console.warn('v48 approve notify skipped:', notifyErr)
    }
    // v49: الاعتماد يُسجل في الرقابة — سجل عمليات + تنبيه رقابي عام
    await logProfileAudit({
      actorId: user.id, action: 'approve', entity: 'purchase', entityId: purchase.id,
      details: JSON.stringify({
        summary: 'اعتماد فاتورة «' + purchase.title + '» وتسجيلها تلقائياً في التكاليف',
        changes: [
          { field: 'الحالة', fieldEn: 'Status', old: 'مقدمة للمراجعة', new: 'معتمدة' },
          { field: 'التصنيف', fieldEn: 'Category', old: '', new: category },
          { field: 'المبلغ', fieldEn: 'Amount', old: '', new: purchase.amount + ' ر.ع' },
        ],
      }),
    })
    await logOversightEvent({
      type: 'purchase_log',
      title: 'نشاط مشتريات — اعتماد',
      message: (user.name || 'مراجع') + ' اعتمد فاتورة «' + purchase.title + '» بمبلغ ' + purchase.amount + ' ر.ع وسُجلت تلقائياً في قسم التكاليف',
      severity: 'info',
      link: 'dashboard', entityType: 'purchase', entityId: purchase.id,
    })
    return NextResponse.json({ ok: true, purchase: approved, costId: cost.id })
  } catch (e) {
    console.error('v48 invoices-review POST failed:', e)
    return NextResponse.json({ error: 'database_error', message: 'فشل تسجيل المراجعة' }, { status: 500 })
  }
}
