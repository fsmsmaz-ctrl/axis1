// ============================================================
// v121 — خطة عمل الماكينات: وحدة الحسابات الهندسية
// ملف نقائي (بلا أي استيراد خادمي) — تستخدمه الواجهة والخادم معاً
// لضمان تطابق الأرقام في النموذج وفي عرض المخطط.
//
// القاعدتان الأساسيتان (من المواصفة):
//   أ) التخطيط حسب متوسط الإنتاج:
//      عدد أيام الحفر = ceil(طول النفق ÷ متوسط الإنتاج المتوقع)
//      وتاريخ النهاية = أول يوم عمل + (عدد أيام الحفر − 1) أيام عمل.
//   ب) التخطيط حسب تاريخ الانتهاء:
//      متوسط الإنتاج المطلوب = طول النفق ÷ عدد أيام العمل بين
//      البداية والنهاية (أيام عمل فعلية فقط وفق تقويم المشروع).
//
// ملاحظات صارمة:
//   • كل التواريخ تُعالَج UTC منتصف الليل — لا فرق توقيت ولا انزياح يوم.
//   • أيام التجهيز (Mobilization) ورفع الماكينة (Demobilization) ليست
//     أيام إنتاج حفر إطلاقاً — الحساب يقتصر على شريط الحفر (digging) وحده.
//   • مثال الاختبار الإلزامي: طول 30 م × إنتاج 1.5 م/يوم = 20 يوم عمل بالضبط.
// ============================================================

export interface HolidayConfig {
  // أيام الإجازة الأسبوعية — أرقام أيام JS بالتوقيت العالمي: 0=الأحد … 6=السبت
  weekdays: number[]
  // عطل محددة بتواريخ (YYYY-MM-DD) — أعياد رسمية أو توقفات مخططة
  dates: string[]
  // نظام الورديات: single = وردية نهارية، day_night = حفر نهاري وليلي متواصل
  // (الحفر الليلي لا يزيد عدد أيام الإنتاج — الإنتاجية اليومية تعكسه أصلاً)
  shift: 'single' | 'day_night'
}

export const DEFAULT_HOLIDAYS: HolidayConfig = { weekdays: [5], dates: [], shift: 'single' } // الجمعة افتراضياً

export const ACTIVITY_TYPES: Record<string, { ar: string; en: string }> = {
  mobilization:  { ar: 'التجهيز (Mobilization)',            en: 'Mobilization' },
  pit_prep:      { ar: 'تجهيز الحفرة وتركيب الماكينة',      en: 'Shaft prep & machine installation' },
  digging:       { ar: 'الحفر (Digging)',                   en: 'Digging' },
  demobilization:{ ar: 'رفع الماكينة (Demobilization)',     en: 'Demobilization' },
  custom:        { ar: 'نشاط آخر',                          en: 'Custom activity' },
}

export const CONFIDENCE_LEVELS: Record<string, { ar: string; en: string; chip: string; dot: string }> = {
  green: { ar: 'احتمال مرتفع — يمكن تحقيق المتوسط', en: 'High — rate achievable',   chip: 'bg-emerald-50 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },
  yellow:{ ar: 'احتمال متوسط — يحتاج متابعة',       en: 'Medium — needs follow-up', chip: 'bg-amber-50 text-amber-700 border-amber-300',       dot: 'bg-amber-500' },
  red:   { ar: 'احتمال منخفض — مخاطرة عالية',       en: 'Low — high risk',          chip: 'bg-red-50 text-red-700 border-red-300',             dot: 'bg-red-500' },
  gray:  { ar: 'لم يتم تقييم الإنتاج بعد',          en: 'Not assessed yet',         chip: 'bg-gray-100 text-gray-600 border-gray-300',         dot: 'bg-gray-400' },
}

export const PLAN_STATUSES: Record<string, { ar: string; en: string; chip: string; dot: string }> = {
  not_started: { ar: 'لم يبدأ',          en: 'Not started',      chip: 'bg-slate-100 text-slate-700 border-slate-300',  dot: 'bg-slate-400' },
  on_track:    { ar: 'يسير حسب الخطة',   en: 'On track',         chip: 'bg-emerald-50 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },
  at_risk:     { ar: 'معرض للتأخير',     en: 'At risk',          chip: 'bg-amber-50 text-amber-700 border-amber-300',   dot: 'bg-amber-500' },
  late:        { ar: 'متأخر',            en: 'Late',             chip: 'bg-red-50 text-red-700 border-red-300',         dot: 'bg-red-500' },
  completed:   { ar: 'مكتمل',            en: 'Completed',        chip: 'bg-blue-50 text-blue-700 border-blue-300',      dot: 'bg-blue-500' },
  suspended:   { ar: 'متوقف',            en: 'Suspended',        chip: 'bg-gray-100 text-gray-600 border-gray-300',     dot: 'bg-gray-500' },
}

// ─── تواريخ UTC آمنة ─────────────────────────────────────────────

// 'YYYY-MM-DD' أو Date → Date بتوقيت UTC منتصف الليل (بلا انزياح توقيت)
export function parseDateOnly(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) { var d0 = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())); return isNaN(d0.getTime()) ? null : d0 }
  var s = String(v).trim()
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  var d = new Date(s)
  if (isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000)
}

// الفرق بالأيام التقويمية: b − a
export function diffCalendarDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// ─── تقويم العمل ─────────────────────────────────────────────────

export function parseHolidayConfig(json: string | null | undefined): HolidayConfig {
  if (!json) return { ...DEFAULT_HOLIDAYS }
  try {
    var o = JSON.parse(json)
    var weekdays = Array.isArray(o.weekdays) ? o.weekdays.filter(function (x) { return typeof x === 'number' && x >= 0 && x <= 6 }) : DEFAULT_HOLIDAYS.weekdays
    var dates = Array.isArray(o.dates) ? o.dates.filter(function (x) { return typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) }) : []
    var shift: 'single' | 'day_night' = o.shift === 'day_night' ? 'day_night' : 'single'
    return { weekdays: weekdays, dates: dates, shift: shift }
  } catch { return { ...DEFAULT_HOLIDAYS } }
}

export function isWorkingDay(d: Date, cfg: HolidayConfig): boolean {
  if (cfg.weekdays.indexOf(d.getUTCDay()) !== -1) return false
  if (cfg.dates.indexOf(toISODate(d)) !== -1) return false
  return true
}

// عدد أيام العمل بين تاريخين — شامل الطرفين (0 إن كانت النهاية قبل البداية)
export function countWorkingDaysInclusive(start: Date, end: Date, cfg: HolidayConfig): number {
  if (end.getTime() < start.getTime()) return 0
  var n = 0
  var cur = new Date(start.getTime())
  while (cur.getTime() <= end.getTime()) {
    if (isWorkingDay(cur, cfg)) n++
    cur = addDaysUTC(cur, 1)
    if (n > 3000) break // حماية من الحلقات الشاذة
  }
  return n
}

// تقدُّم n يوم عمل من تاريخ البداية — أول يوم عمل في البداية نفسها؛
// إذا كانت البداية يوم إجازة تُمدَّح للأول يوم عمل تالٍ ثم يبدأ العدّ.
export function addWorkingDays(start: Date, nWorkingDays: number, cfg: HolidayConfig): Date {
  var cur = new Date(start.getTime())
  var guard = 0
  while (!isWorkingDay(cur, cfg) && guard < 3660) { cur = addDaysUTC(cur, 1); guard++ }
  if (nWorkingDays <= 0) return cur
  var left = nWorkingDays - 1 // يوم البداية نفسه يُحتسب
  while (left > 0 && guard < 3660) {
    cur = addDaysUTC(cur, 1)
    guard++
    if (isWorkingDay(cur, cfg)) left--
  }
  return cur
}

// ─── الحسابات الأساسية ───────────────────────────────────────────

// عدد أيام الحفر = تقريب (الطول ÷ الإنتاج) لأعلى عدد صحيح — دائماً ≥ 1
export function computeDiggingDays(lengthM: number, rateMPerDay: number): number {
  if (!(lengthM > 0) || !(rateMPerDay > 0)) return 0
  return Math.max(1, Math.ceil(lengthM / rateMPerDay))
}

// متوسط الإنتاج المطلوب = الطول ÷ عدد أيام العمل
export function computeRequiredRate(lengthM: number, workingDays: number): number {
  if (!(lengthM > 0) || !(workingDays > 0)) return 0
  return lengthM / workingDays
}

export interface PlanningInput {
  mode: 'by_rate' | 'by_end_date'
  lengthM: number
  start: Date | string | null
  end?: Date | string | null      // للوضع (ب) فقط
  rate?: number | string | null   // متوسط الإنتاج المتوقع (إدخال المستخدم — رقم أو نص)
  holidays?: HolidayConfig
}

export interface PlanningResult {
  ok: boolean
  issues: string[]            // رسائل خطأ إدخال (بالعربية — جاهزة للعرض)
  diggingDays: number         // عدد أيام الحفر المحسوبة
  computedEnd: Date | null    // تاريخ نهاية الحفر المحسوب (الوضع أ)
  workingDays: number         // أيام العمل بين البداية والنهاية (الوضع ب)
  requiredRate: number        // متوسط الإنتاج المطلوب (م/يوم)
  enteredRate: number         // المتوسط المدخل
  rateGap: number             // المدخل − المطلوب (موجب = هامش أمان)
  feasible: boolean | null    // هل الخطة قابلة للتحقيق؟ (null = لا يوجد مقارنة بعد)
}

// محرّك التخطيط الموحّد — يعمل في النموذج (مباشرة) وعلى الخادم (تحقق نهائي)
export function computePlanning(input: PlanningInput): PlanningResult {
  var cfg = input.holidays || DEFAULT_HOLIDAYS
  var res: PlanningResult = { ok: false, issues: [], diggingDays: 0, computedEnd: null, workingDays: 0, requiredRate: 0, enteredRate: 0, rateGap: 0, feasible: null }
  var start = parseDateOnly(input.start)
  var end = parseDateOnly(input.end || null)
  var rate = typeof input.rate === 'number' ? input.rate : (typeof input.rate === 'string' && input.rate.trim() !== '' ? parseFloat(input.rate) : NaN)

  if (!(input.lengthM > 0)) res.issues.push('طول النفق يجب أن يكون أكبر من صفر')
  if (!start) res.issues.push('تاريخ البداية مطلوب')
  if (input.mode === 'by_end_date' && !end) res.issues.push('تاريخ النهاية مطلوب في هذا الوضع')
  if (input.mode === 'by_rate' && !(rate > 0)) res.issues.push('متوسط الإنتاج المتوقع يجب أن يكون أكبر من صفر')
  if (start && end && end.getTime() < start.getTime()) res.issues.push('تاريخ النهاية قبل تاريخ البداية')
  if (res.issues.length > 0) return res

  if (input.mode === 'by_rate') {
    // (أ) التخطيط حسب متوسط الإنتاج
    // تاريخ النهاية = أول يوم عمل + (عدد أيام الحفر − 1) خطوات عمل —
    // ودلالة addWorkingDays: البداية نفسها تُحتسب يوماً أول، فالنداء
    // الصحيح هو (البداية، عدد الأيام) وليس (العدد − 1) وإلا فقدنا يوماً.
    res.enteredRate = rate
    res.diggingDays = computeDiggingDays(input.lengthM, rate)
    res.computedEnd = addWorkingDays(start as Date, res.diggingDays, cfg)
    res.workingDays = res.diggingDays
    res.ok = true
    return res
  }

  // (ب) التخطيط حسب تاريخ الانتهاء
  res.workingDays = countWorkingDaysInclusive(start as Date, end as Date, cfg)
  if (!(res.workingDays > 0)) { res.issues.push('لا توجد أيام عمل بين البداية والنهاية وفق تقويم المشروع — عدّل التواريخ أو تقويم الإجازات'); return res }
  res.requiredRate = computeRequiredRate(input.lengthM, res.workingDays)
  res.diggingDays = res.workingDays
  res.computedEnd = end
  if (rate > 0) {
    res.enteredRate = rate
    res.rateGap = rate - res.requiredRate
    // هامش تسامح 1% لتفادي الإنذارات الكاذبة حول التقريب
    res.feasible = res.rateGap >= -0.01 * Math.max(1, res.requiredRate)
  } else {
    res.enteredRate = 0
    res.feasible = null
  }
  res.ok = true
  return res
}

// ─── متابعة الإنجاز والتأخير ─────────────────────────────────────

export interface ProgressInput {
  tunnelLength: number
  start: Date | string | null
  end: Date | string | null
  avgRate?: number | null
  holidays?: HolidayConfig
  actualMeters: number          // مسحوبة تلقائياً من التقارير اليومية المعتمدة
  today?: Date | string | null
  statusOverride?: string | null // «متوقف» فقط — الباقي يُحسب
}

export interface PlanProgress {
  status: 'not_started' | 'on_track' | 'at_risk' | 'late' | 'completed' | 'suspended'
  elapsedWorkingDays: number   // أيام عمل منذ البداية حتى اليوم (سقفها نهاية الخطة)
  expectedToDate: number       // الإنجاز المتوقع حتى تاريخ اليوم (م)
  actualMeters: number         // الإنجاز الفعلي (م)
  metersBehind: number         // الفرق: المتوقع − الفعلي (موجب = تأخر تراكمي)
  remaining: number            // المتبقي (م)
  pct: number                  // نسبة الإنجاز 0–100
  actualRate: number           // متوسط الإنتاج الفعلي حتى اليوم (م/يوم عمل)
  requiredToFinish: number     // الإنتاج المطلوب لإنهاء المتبقي ضمن نهاية الخطة (م/يوم)
  projectedEnd: Date | null    // تاريخ الانتهاء المتوقع (بلا تغيير الخطة الأصلية)
  delayDays: number            // عدد أيام التأخير المتوقعة/الفعلية
}

export function computePlanProgress(input: ProgressInput): PlanProgress {
  var cfg = input.holidays || DEFAULT_HOLIDAYS
  var today = parseDateOnly(input.today || new Date()) || new Date()
  var start = parseDateOnly(input.start)
  var end = parseDateOnly(input.end)
  var length = input.tunnelLength
  var rate = typeof input.avgRate === 'number' && input.avgRate > 0 ? input.avgRate : 0
  var actual = input.actualMeters > 0 ? input.actualMeters : 0
  var out: PlanProgress = { status: 'not_started', elapsedWorkingDays: 0, expectedToDate: 0, actualMeters: actual, metersBehind: 0, remaining: Math.max(0, length - actual), pct: length > 0 ? Math.min(100, (actual / length) * 100) : 0, actualRate: 0, requiredToFinish: 0, projectedEnd: null, delayDays: 0 }

  if (input.statusOverride === 'suspended') { out.status = 'suspended'; return out }
  if (!start || !end) return out

  var remaining = out.remaining
  if (remaining <= 0 && length > 0) { out.status = 'completed'; return out }
  if (today.getTime() < start.getTime()) { out.status = 'not_started'; return out }

  // أيام عمل المنقضية: من البداية حتى اليوم (بسقف نهاية الخطة للحساب المتوقع)
  var effectiveToday = today.getTime() > end.getTime() ? end : today
  out.elapsedWorkingDays = countWorkingDaysInclusive(start, effectiveToday, cfg)
  out.expectedToDate = rate > 0 ? rate * out.elapsedWorkingDays : 0
  out.metersBehind = Math.max(0, out.expectedToDate - actual)
  if (out.elapsedWorkingDays > 0) out.actualRate = actual / out.elapsedWorkingDays

  var remainingWorkingToPlannedEnd = countWorkingDaysInclusive(today, end, cfg)
  out.requiredToFinish = remainingWorkingToPlannedEnd > 0 ? remaining / remainingWorkingToPlannedEnd : (remaining > 0 ? Infinity : 0)

  // تاريخ الانتهاء المتوقع: بالمعدل الفعلي إن وُجد — وإلا بالمعدل المخطط
  var pace = out.actualRate > 0 ? out.actualRate : rate
  if (remaining > 0 && pace > 0) {
    var daysNeeded = Math.max(1, Math.ceil(remaining / pace))
    // اليوم الحالي يُحتسب أول يوم إنتاج إن كان يوم عمل — النهاية = اليوم daysNeeded من الإنتاج
    out.projectedEnd = addWorkingDays(today, daysNeeded, cfg)
  } else if (remaining <= 0) {
    out.projectedEnd = end
  }

  var isLate = false
  if (today.getTime() > end.getTime() && remaining > 0) isLate = true
  if (out.projectedEnd && out.projectedEnd.getTime() > end.getTime()) isLate = true
  if (isLate) {
    out.status = 'late'
    var lateRef = out.projectedEnd && out.projectedEnd.getTime() > today.getTime() ? out.projectedEnd : today
    out.delayDays = Math.max(1, diffCalendarDays(end, lateRef))
    return out
  }

  // معرض للتأخير: متأخر عن منحنى الخطة (الفعلية أقل من المتوقعة بهامش معنوي)
  // مع بقاء نهاية متوقعة داخل الخطة — أو معدل فعلي أقل من المطلوب للإنهاء في الوقت
  var behindThreshold = Math.max(0.5, length * 0.05)
  if (out.metersBehind > behindThreshold || (out.actualRate > 0 && out.requiredToFinish > 0 && out.actualRate < out.requiredToFinish - 0.01)) {
    out.status = 'at_risk'
    return out
  }

  out.status = 'on_track'
  return out
}

// حالة مبسطة للأعمال غير الإنتاجية (تجهيز/رفع/أنشطة أخرى) — بالتقويم فقط
export function calendarStatus(start: Date | string | null, end: Date | string | null, today?: Date | string | null, statusOverride?: string | null): 'not_started' | 'on_track' | 'late' | 'completed' | 'suspended' {
  if (statusOverride === 'suspended') return 'suspended'
  var s = parseDateOnly(start), e = parseDateOnly(end), t = parseDateOnly(today || new Date()) || new Date()
  if (!s || !e) return 'on_track'
  if (t.getTime() < s.getTime()) return 'not_started'
  if (t.getTime() > e.getTime()) return 'late'
  return 'on_track'
}
