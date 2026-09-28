// ============================================================
// v53: أدوات الموارد البشرية على الخادم — AXIS
// الرصيد والسياسة وأيام العمل — منطق موحّد بين كل مسارات /api/hr
// كل التواريخ تُعامل كأيام UTC (منتصف ليل) اتساقاً مع parseDateRange
// ============================================================

import { db } from './db'

// ── رصيد الإجازات: إنشاء تلقائي عند أول استخدام (افتراضي من السياسة) ──
export async function getOrCreateBalance(userId: string, defaultAnnualDays?: number): Promise<{
  id: string; userId: string; annualTotal: number; carriedOver: number; used: number; updatedAt: Date
}> {
  var b = await db.leaveBalance.findUnique({ where: { userId } })
  if (b) return b
  try {
    return await db.leaveBalance.create({
      data: { userId, annualTotal: typeof defaultAnnualDays === 'number' ? defaultAnnualDays : 30 },
    })
  } catch (e) {
    // سباق إنشاء متزامن — أعد القراءة
    var again = await db.leaveBalance.findUnique({ where: { userId } })
    if (again) return again
    throw e
  }
}

// ── سياسة الإجازات: صف وحيد يُنشأ تلقائياً بالافتراضي (الجمعة والسبت، 30 يوماً) ──
export async function getPolicy(): Promise<{
  weekendDays: string; defaultAnnualDays: number; sickAttachRequired: boolean
}> {
  var p = await db.leavePolicy.findFirst()
  if (p) {
    return {
      weekendDays: p.weekendDays || '5,6',
      defaultAnnualDays: p.defaultAnnualDays ?? 30,
      sickAttachRequired: p.sickAttachRequired !== false,
    }
  }
  try {
    var created = await db.leavePolicy.create({ data: { singleton: 'default' } })
    return {
      weekendDays: created.weekendDays || '5,6',
      defaultAnnualDays: created.defaultAnnualDays ?? 30,
      sickAttachRequired: created.sickAttachRequired !== false,
    }
  } catch (e) {
    var again = await db.leavePolicy.findFirst()
    if (again) {
      return {
        weekendDays: again.weekendDays || '5,6',
        defaultAnnualDays: again.defaultAnnualDays ?? 30,
        sickAttachRequired: again.sickAttachRequired !== false,
      }
    }
    throw e
  }
}

// ── أيام نهاية الأسبوع من نص السياسة («5,6» → مجموعة أرقام getDay) ──
export function parseWeekend(weekendDays: string): Set<number> {
  var set = new Set<number>()
  String(weekendDays || '').split(',').forEach(function(s) {
    var n = parseInt(s.trim(), 10)
    if (!isNaN(n) && n >= 0 && n <= 6) set.add(n)
  })
  return set
}

// ── تحليل «YYYY-MM-DD» إلى منتصف ليل UTC — يُرجع null عند عدم الصلاحية ──
export function parseDay(s: any): Date | null {
  if (typeof s !== 'string') return null
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  var dt = new Date(Date.UTC(y, mo - 1, d))
  return isNaN(dt.getTime()) ? null : dt
}

// ── مفتاح اليوم: عدد الأيام منذ البداية (للمقارنات ومفاتيح العطلات) ──
export function dayKey(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000)
}

// ── حساب أيام العمل بين تاريخين (شامل الطرفين) — يستثني نهاية الأسبوع والعطلات الرسمية ──
export function countWorkingDays(startUtc: Date, endUtc: Date, weekend: Set<number>, holidayKeys: Set<number>): number {
  var count = 0
  var cur = new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth(), startUtc.getUTCDate()))
  var end = Date.UTC(endUtc.getUTCFullYear(), endUtc.getUTCMonth(), endUtc.getUTCDate())
  var guard = 0
  while (cur.getTime() <= end && guard < 800) {
    if (!weekend.has(cur.getUTCDay()) && !holidayKeys.has(dayKey(cur))) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
    guard++
  }
  return count
}

// ── مفاتيح أيام العطلات من قاعدة البيانات (لتسريع الحساب) ──
export async function loadHolidayKeys(): Promise<Set<number>> {
  var holidays = await db.holiday.findMany({ select: { date: true } })
  var set = new Set<number>()
  for (var i = 0; i < holidays.length; i++) {
    set.add(dayKey(new Date(holidays[i].date)))
  }
  return set
}

// ── تنسيق تاريخ للرسائل (عربي مختصر) ──
export function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── تسميات أنواع الإجازات (لرسائل التنبيهات) ──
export const LEAVE_TYPE_LABELS_AR: Record<string, string> = {
  annual: 'سنوية',
  sick: 'مرضية',
  emergency: 'طارئة',
  unpaid: 'بدون راتب',
  other: 'أخرى',
}
