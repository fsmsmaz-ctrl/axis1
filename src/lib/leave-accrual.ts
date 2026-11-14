// ============================================================
// v118: خوارزمية احتساب الإجازات التلقائية — AXIS
// ============================================================
// القاعدة كما طلبتها الإدارة حرفياً:
//   1) كل موظف يكتسب 2.5 يوم إجازة عن كل شهر مكتمل — تُضاف تلقائياً لرصيده.
//   2) طلب الإجازة السنوية يُخصم من الرصيد عند الاعتماد.
//   3) إن طلب الموظف إجازة ولم يكن في رصيده ما يكفي → يصبح الرصيد سالباً
//      (الطلب مسموح ولا يُرفض بسبب الرصيد).
//   4) الرصيد السالب يتعافى تلقائياً: مع اكتمال كل شهر يزيد الاستحقاق 2.5 يوم
//      (شهر = 2.5، شهران = 5، ثلاثة أشهر = 7.5 ... وهكذا).
//   5) الاحتساب يبدأ من تاريخ بدء عقد العمل (contractStart)، وإن لم يُدخل
//      فمن تاريخ الالتحاق (joinDate) — وإن كان الاثنان فارغين يكون الاستحقاق
//      صفراً حتى تُدخل الإدارة أحد التاريخين.
// ============================================================
// ملاحظات تنفيذية:
//   • «شهر مكتمل» = مرور شهر تقويمي كامل من تاريخ البداية (عقد بدأ 15 يناير
//     يكتمل شهره الأول في 15 فبراير). ويُعالج نهاية الشهر: عقد بدأ 31 يناير
//     يكتمل شهره الأول في 28 فبراير.
//   • لا تخزين للرصيد المكتسب — يُحسب لحظياً من التاريخ، فلا يمكن أن يخطئ
//     أو يُنسى شهر، والتعافي من السالب يحدث تلقائياً مع مرور الزمن.
//   • تعديلات الإدارة اليدوية (LeaveAdjustment) تُطبَّق على «used» وهي
//     واردة في المعادلة تلقائياً — لم تتغير آليتها إطلاقاً.
// ============================================================

// الاستحقاق الشهري الثابت — 2.5 يوم عن كل شهر مكتمل
export var LEAVE_MONTHLY_ACCRUAL = 2.5

// تقريب لنصف يوم واحد لإزالة ضجيج الأرقام العشرية (27.499999 → 27.5)
export function roundHalfDay(n: number): number {
  return Math.round(n * 10) / 10
}

// عدد أيام الشهر الميلادي بالتوقيت UTC (m بصيغة JS: 0=يناير)
function lastDayOfUtcMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

// ── عدد الشهور المكتملة بين تاريخين ──
// الشهر يكتمل عند بلوغ نفس رقم يوم البداية، أو عند نهاية الشهر الحالي
// إن كان يوم البداية غير موجود فيه أصلاً (31 يناير → يكتمل في 28 فبراير)
export function completedMonths(startUtc: Date, todayUtc: Date): number {
  var s = new Date(Date.UTC(startUtc.getUTCFullYear(), startUtc.getUTCMonth(), startUtc.getUTCDate()))
  var t = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()))
  if (t.getTime() < s.getTime()) return 0
  var months = (t.getUTCFullYear() - s.getUTCFullYear()) * 12 + (t.getUTCMonth() - s.getUTCMonth())
  var d1 = s.getUTCDate()
  var d2 = t.getUTCDate()
  var lastD2 = lastDayOfUtcMonth(t.getUTCFullYear(), t.getUTCMonth())
  if (d2 < d1 && !(d1 > lastD2 && d2 === lastD2)) months--
  return Math.max(0, months)
}

// ── تاريخ بدء الاحتساب: بدء العقد أولاً ثم الالتحاق ──
export function leaveAccrualBasis(
  user: { contractStart?: Date | string | null; joinDate?: Date | string | null }
): { basis: 'contract' | 'join' | null; date: Date | null } {
  if (user.contractStart) {
    var cs = new Date(user.contractStart)
    if (!isNaN(cs.getTime())) {
      return { basis: 'contract', date: new Date(Date.UTC(cs.getUTCFullYear(), cs.getUTCMonth(), cs.getUTCDate())) }
    }
  }
  if (user.joinDate) {
    var jd = new Date(user.joinDate)
    if (!isNaN(jd.getTime())) {
      return { basis: 'join', date: new Date(Date.UTC(jd.getUTCFullYear(), jd.getUTCMonth(), jd.getUTCDate())) }
    }
  }
  return { basis: null, date: null }
}

// ── الرصيد الفعلي الكامل لموظف ──
// user: حقلا التاريخ من جدول User (أي كائن يحملهما)، used: المستخدم من LeaveBalance
// (المستخدم يشمل الإجازات المعتمدة + تعديلات الإدارة اليدوية تلقائياً)
export function computeEffectiveLeave(
  user: { contractStart?: Date | string | null; joinDate?: Date | string | null },
  used: number | null | undefined,
  today?: Date
): {
  basis: 'contract' | 'join' | null
  basisDate: string | null
  months: number
  accrued: number
  used: number
  remaining: number
  monthlyAccrual: number
} {
  var basis = leaveAccrualBasis(user)
  var now = today || new Date()
  var months = basis.date ? completedMonths(basis.date, now) : 0
  var accrued = roundHalfDay(months * LEAVE_MONTHLY_ACCRUAL)
  var usedR = roundHalfDay(typeof used === 'number' && isFinite(used) ? used : 0)
  return {
    basis: basis.basis,
    basisDate: basis.date ? basis.date.toISOString().slice(0, 10) : null,
    months: months,
    accrued: accrued,
    used: usedR,
    // المتبقي قد يكون سالباً — وهذا مقصود: الطلب مسموح والرصيد يتعافى شهرياً
    remaining: roundHalfDay(accrued - usedR),
    monthlyAccrual: LEAVE_MONTHLY_ACCRUAL,
  }
}
