// ============================================================
// v120 — «تذكيراتي»: المهام الشخصية الخاصة بالموظف
// GET / POST / PATCH / DELETE — /api/my-reminders
// ============================================================
// الخصوصية المطلقة (مضمونة بالتصميم لا بالفلاتر):
//   • كل تذكير مرتبط بمالكه الوحيد (userId) — كل عمليات القراءة والتعديل
//     والحذف تُقيَّد إلزامياً بمعرّف صاحب الجلسة نفسه، فلا يستطيع أي حساب آخر
//     (ولا حتى الإدارة أو مدير النظام) إنشاء أو قراءة أو تعديل أو حذف
//     تذكير لا يملكه، ولا حتى بالتخمين عبر المعرفات.
//   • لا يوجد أي مسار إداري أو باراميتر لاستعلام تذكيرات شخص آخر — لا يوجد
//     إطلاقاً استعلام يستخدم معرف مستخدم قادم من العميل.
//   • منفصل تماماً عن جدول المهام الرسمي: لا يظهر في تقرير الأداء ولا الرقابة
//     ولا قوائم الإدارة — لا يرى الموظفون الآخرون شيئاً منه.
// التنبيهات المستمرة:
//   • عند كل جلب يُفحص (بخمول 10 دقائق) ما استحق خلال 24 ساعة أو تأخر،
//     ويُنشأ تنبيه يومي مخصص للمالك فقط حتى ينجز المهمة — يتكرر كل يوم
//     (معرّف المنع من التكرار يحمل تاريخ اليوم) فلا يفوته موعده.
//   • إنجاز التذكير أو تعديل موعده يوقف تنبيهات التأخير فوراً.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { ensurePersonalRemindersSupport } from '@/lib/db-selfheal'

const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low']

function dayKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

// ─── التنبيهات المستمرة (بخمول 10 دقائق — نفس نمط task-watch) ───
const SCAN_INTERVAL_MS = 10 * 60 * 1000
var lastPersonalScanAt: number = 0
var personalScanInFlight: Promise<{ created: number }> | null = null

async function runPersonalScanNow(userId: string): Promise<{ created: number }> {
  let created = 0
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const today = dayKey(now)

  // التذكيرات المفتوحة التي استحقت أو تقترب مدتها — للمالك نفسه فقط
  const due = await db.personalReminder.findMany({
    where: { userId, done: false, dueDate: { lte: in24h } },
    select: { id: true, title: true, dueDate: true },
    take: 50,
    orderBy: { dueDate: 'asc' },
  })

  for (const r of due) {
    const overdue = new Date(r.dueDate).getTime() < now.getTime()
    // معرّف المنع من التكرار يحمل تاريخ اليوم → تنبيه واحد يومياً لكل تذكير،
    // ويتكرر في اليوم التالي حتى يُنجز — تنبيهات مستمرة بلا إزعاج مكرر بنفس اليوم
    const entityId = r.id + ':' + today
    const type = overdue ? 'personal_reminder_overdue' : 'personal_reminder_due'
    const dup = await db.notification.findFirst({
      where: { type, entityId, userId },
      select: { id: true },
    })
    if (dup) continue
    await db.notification.create({
      data: {
        userId,
        type,
        title: overdue ? 'تذكير عاجل: مهمة شخصية متأخرة عن موعدها' : 'تذكير: مهمة شخصية تستحق اليوم',
        message: overdue
          ? 'المهمة الشخصية («' + r.title + '») تجاوزت تاريخ النهاية (' + fmtDate(new Date(r.dueDate)) + ') ولم تُنجز بعد — من «تذكيراتي» في إدارة المهام.'
          : 'المهمة الشخصية («' + r.title + '») تاريخ نهايتها ' + fmtDate(new Date(r.dueDate)) + ' — جهّزها قبل انتهاء الوقت. من «تذكيراتي» في إدارة المهام.',
        severity: overdue ? 'critical' : 'warning',
        link: 'tasks',
        entityType: 'personal_reminder',
        entityId,
      },
    })
    created += 1
  }
  return { created }
}

async function runPersonalScanThrottled(userId: string): Promise<void> {
  const nowMs = Date.now()
  if (nowMs - lastPersonalScanAt < SCAN_INTERVAL_MS) return
  if (personalScanInFlight) { await personalScanInFlight.catch(() => {}); return }
  lastPersonalScanAt = nowMs
  personalScanInFlight = runPersonalScanNow(userId)
  try { await personalScanInFlight } catch (e) {
    console.error('[my-reminders] scan failed:', e)
  } finally {
    personalScanInFlight = null
  }
}

// ─── GET: قائمة تذكيراتي فقط ───
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    await ensurePersonalRemindersSupport()

    // فحص الاستحقاق وإصدار التنبيهات اليومية المستمرة (بخمول)
    await runPersonalScanThrottled(user.id).catch(() => {})

    const reminders = await safeDbOp(
      () => db.personalReminder.findMany({
        where: { userId: user.id },
        orderBy: [{ done: 'asc' }, { dueDate: 'asc' }],
        take: 300,
      }),
      'جلب التذكيرات الشخصية'
    )
    if (!reminders.success) return reminders.response

    return NextResponse.json(
      { reminders: reminders.data },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error: any) {
    return handleDbError(error, 'جلب التذكيرات الشخصية')
  }
}

// ─── POST: إنشاء تذكير شخصي لنفسي فقط ───
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    await ensurePersonalRemindersSupport()

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }

    const body = await req.json().catch(() => ({} as any))
    const validationError = validateRequired(body, ['title', 'dueDate'])
    if (validationError) return validationError

    const title = String(body.title).trim().slice(0, 200)
    if (!title) {
      return NextResponse.json({ error: 'invalid_value', message: 'عنوان المهمة مطلوب' }, { status: 400 })
    }
    const priority = VALID_PRIORITIES.includes(String(body.priority)) ? String(body.priority) : 'normal'
    const details = body.details ? String(body.details).trim().slice(0, 5000) : null
    const dueDate = new Date(body.dueDate)
    if (isNaN(dueDate.getTime())) {
      return NextResponse.json({ error: 'invalid_value', message: 'تاريخ نهاية المهمة غير صالح' }, { status: 400 })
    }
    // نطاق منطقي للتاريخ — حماية من القيم الشاذة
    if (dueDate.getFullYear() < 2000 || dueDate.getFullYear() > 2100) {
      return NextResponse.json({ error: 'invalid_value', message: 'تاريخ النهاية خارج النطاق المسموح' }, { status: 400 })
    }

    // المالك = صاحب الجلسة حصراً — لا يُقبل معرف مستخدم من العميل إطلاقاً
    const createResult = await safeDbOp(
      () => db.personalReminder.create({
        data: {
          userId: user.id,
          title,
          details,
          priority,
          dueDate,
        },
      }),
      'إنشاء تذكير شخصي'
    )
    if (!createResult.success) return createResult.response

    return NextResponse.json({ reminder: createResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'إنشاء تذكير شخصي')
  }
}

// ─── PATCH: تعديل تذكير لي فقط (إنجاز / إعادة فتح / تعديل البيانات) ───
export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    await ensurePersonalRemindersSupport()

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }

    const body = await req.json().catch(() => ({} as any))
    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'invalid_value', message: 'معرف التذكير مطلوب' }, { status: 400 })
    }

    const existing = await db.personalReminder.findFirst({
      where: { id: body.id, userId: user.id },
      select: { id: true, done: true, dueDate: true },
    })
    if (!existing) {
      // رسالة موحدة: لا نكشف وجود تذكير لشخص آخر أصلاً
      return NextResponse.json({ error: 'not_found', message: 'التذكير غير موجود' }, { status: 404 })
    }

    const data: any = {}
    if (body.title !== undefined) {
      const title = String(body.title).trim().slice(0, 200)
      if (!title) return NextResponse.json({ error: 'invalid_value', message: 'عنوان المهمة لا يمكن أن يكون فارغاً' }, { status: 400 })
      data.title = title
    }
    if (body.details !== undefined) {
      data.details = body.details ? String(body.details).trim().slice(0, 5000) : null
    }
    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(String(body.priority))) {
        return NextResponse.json({ error: 'invalid_value', message: 'قيمة الضرورة غير صالحة' }, { status: 400 })
      }
      data.priority = String(body.priority)
    }
    if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
      const dueDate = new Date(body.dueDate)
      if (isNaN(dueDate.getTime())) {
        return NextResponse.json({ error: 'invalid_value', message: 'تاريخ النهاية غير صالح' }, { status: 400 })
      }
      if (dueDate.getFullYear() < 2000 || dueDate.getFullYear() > 2100) {
        return NextResponse.json({ error: 'invalid_value', message: 'تاريخ النهاية خارج النطاق المسموح' }, { status: 400 })
      }
      data.dueDate = dueDate
    }
    if (body.done !== undefined) {
      data.done = Boolean(body.done)
      // طابع الإنجاز يضبطه الخادم وحده — إنجاز = الآن، إعادة فتح = يُمسح
      data.doneAt = body.done ? new Date() : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'invalid_value', message: 'لا يوجد أي تعديل مطلوب' }, { status: 400 })
    }

    // updateMany بشرط الملكية: التعديل ينجح فقط إن كان التذكير ملك صاحب الجلسة
    const upd = await db.personalReminder.updateMany({
      where: { id: body.id, userId: user.id },
      data,
    })
    if (upd.count === 0) {
      return NextResponse.json({ error: 'not_found', message: 'التذكير غير موجود' }, { status: 404 })
    }

    const updated = await db.personalReminder.findFirst({
      where: { id: body.id, userId: user.id },
    })

    return NextResponse.json({ reminder: updated, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تعديل تذكير شخصي')
  }
}

// ─── DELETE: حذف تذكير لي فقط ───
export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })

    await ensurePersonalRemindersSupport()

    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }

    const id = new URL(req.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'invalid_value', message: 'معرف التذكير مطلوب' }, { status: 400 })
    }

    // deleteMany بشرط الملكية: لا يمكن حذف تذكير ليس ملكك حتى لو عُرف معرفه
    const del = await db.personalReminder.deleteMany({
      where: { id, userId: user.id },
    })
    if (del.count === 0) {
      return NextResponse.json({ error: 'not_found', message: 'التذكير غير موجود' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف تذكير شخصي')
  }
}
