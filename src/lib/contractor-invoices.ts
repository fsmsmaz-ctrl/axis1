// ============================================================
// v116 — «فاتورة المقاول»: توليد آلي + موافقة بشرية قبل التسجيل
// AXIS Pipe Jacking Management System
// ============================================================
// التعديل على v114 (طلب صاحب الموقع):
//   لم تعد الفواتير تُسجَّل تلقائياً في التكاليف. النظام يولّد
//   «مقترحات فواتير» لكل 10 أمتار من كل خط حفر (شاملة الخطوط
//   القديمة والمنتهية) ويرسلها إلى نافذة منبثقة خاصة في قسم
//   الإيرادات والتكاليف؛ يقرأ الموظف كل فاتورة ويدخل السعر يدوياً
//   ويوافق عليها، وبعد الموافقة فقط تُسجَّل كفاتورة عادية ضمن
//   الفواتير في القسم.
//
// قواعد الحساب (كما في v114 بدون تغيير):
//   1) الأمتار المحفورة = نفس صيغة النظام المعتمدة (أقصى endReading
//      أو مجموع الأمتار اليومية من تقارير الخط).
//   2) سعر المتر = سعر متر الخط وإلا سعر متر المشروع — يُعرض
//      كـ«مقترح آلي» إرشادي فقط، والسعر النهائي يُدخله الموظف يدوياً.
//   3) كل مقطع كامل (10 م) = مقترح فاتورة، وتاريخه يوم عبور نهاية
//      المقطع في تقارير الحفر (فالمقترحات القديمة تأخذ تواريخها
//      الحقيقية).
//   4) الخط المنتهي يولّد مقترح «فاتورة أخيرة» للباقي غير المكتمل
//      (مثال: 47 م مكتمل = 4 مقترحات كاملة + مقترح أخير لـ 7 أمتار).
//   5) خطوط قديمة مكتملة بلا أي تقارير: يُعتمد طولها الكلي كمقدار
//      حفر (الواقع الهندسي لخط منتهٍ) حتى لا تفوتهم المقترحات.
//
// حذف فواتير v114 القديمة (تنظيف رجعي):
//   كل ما سجلته خوارزمية v114 آلياً يحمل البصمة القديمة
//   «فاتورة مقاول آلية #» — تُحذف هذه الصفوف كلها من القاعدة
//   تلقائياً عند أول تشغيل بعد النشر وبلا أي تدخل بشري. التكرار
//   لاحقاً يحذف صفراً لأن v116 لا ينشئ بهذه البصمة أبداً.
//
// منع التكرار:
//   الفاتورة المعتمدة يدوياً تحمل بصمة «فاتورة مقاول معتمدة #» +
//   معرف الخط ورقم المقطع؛ المقطع المعتمد لا يُقترح مرة أخرى،
//   والفواتير اليدوية الأخرى (بلا بصمة) لا تُمس نهائياً. قبل إنشاء
//   أي فاتورة يُعاد التحقق من صلاحية المقطع ببيانات الحفر الحالية —
//   فإن تغيرت البيانات يُرد الاعتماد برسالة واضحة بدل تسجيل خاطئ.
//
// التشغيل:
//   - التنظيف الرجعي: عند فتح قسم الإيرادات والتكاليف، وفتح قسم
//     خطوط الحفر، وعبر مسار cron اليومي (مُقيَّد 60 ثانية).
//   - قائمة المقترحات: GET /api/contractor-invoices.
//   - الاعتماد: POST /api/contractor-invoices (صلاحية كتابة التكاليف).
// ============================================================

import { db, invalidateCachePrefix } from '@/lib/db'
import { roundMeters, roundMoney } from '@/lib/api-helpers'
import { notifyUsers } from '@/lib/notify'

/** طول المقطع الواحد الذي يولَّد عنه مقترح فاتورة (بالأمتار) */
export const CONTRACTOR_SEGMENT_METERS = 10

/**
 * بصمة فواتير v114 الآلية القديمة — كل صف يحملها يُحذف تلقائياً
 * (تنظيف v116 الرجعي). لا ينشئها النظام بعد v115 إطلاقاً.
 */
export const CONTRACTOR_LEGACY_MARKER = 'فاتورة مقاول آلية #'

/**
 * بصمة الفواتير المعتمدة يدوياً (v116). تحذير: لا تعدّل نصها بعد
 * الإطلاق — بها يُمنع اقتراح المقطع المعتمد مرة أخرى.
 */
export const CONTRACTOR_INVOICE_MARKER = 'فاتورة مقاول معتمدة #'

/** فئة التكلفة المخصصة لفواتير المقاول */
export const CONTRACTOR_COST_CATEGORY = 'contractor'

/** سقف عدد المقترحات المعادة للنافذة (حماية من قوائم عملاقة) */
const MAX_PENDING_RETURNED = 500

/** المدة الدنيا بين تشغيلتين داخل نفس الخادم */
const MIN_INTERVAL_MS = 60_000

// ── أدوات حسابية صرفة ──

interface LineReportRow {
  date: Date
  inc: number
}

function sumIncrements(rows: LineReportRow[]): number {
  var total = 0
  for (var i = 0; i < rows.length; i++) total += rows[i].inc
  return total
}

/** تاريخ أول تقرير عبر فيه الحفر التراكمي حدّ targetMeters (تاريخ الفاتورة الطبيعي) */
function crossingDate(rows: LineReportRow[], targetMeters: number): Date | null {
  var cumulative = 0
  for (var i = 0; i < rows.length; i++) {
    cumulative = roundMeters(cumulative + rows[i].inc)
    if (cumulative >= targetMeters - 0.005) return rows[i].date
  }
  return null
}

/** استخراج بصمة الفاتورة المعتمدة من نص الملاحظات — null يعني «ليست منها» */
function parseApprovedToken(notes: string | null | undefined): string | null {
  if (!notes || notes.indexOf(CONTRACTOR_INVOICE_MARKER) !== 0) return null
  var rest = notes.slice(CONTRACTOR_INVOICE_MARKER.length)
  return rest.length > 0 ? rest : null
}

// ════════════════════════════════════════════════════════════
// 1) التنظيف الرجعي — حذف فواتير v114 الآلية من القاعدة
// ════════════════════════════════════════════════════════════

export interface ContractorMaintenanceResult {
  ran: boolean
  deleted: number
  skipped?: 'throttled'
  error?: string
}

const maintainState: { lastRunAt: number; running: Promise<ContractorMaintenanceResult> | null } = {
  lastRunAt: 0,
  running: null,
}

/**
 * تنظيف رجعي: يحذف كل فواتير v114 الآلية من القاعدة تلقائياً.
 * آمن للاستدعاء المتكرر: بعد أول تشغيل ناجح لا يبقى شيء بهذه
 * البصمة، وفواتير v116 المعتمدة ببصمة أخرى فلا تمسها العملية أبداً.
 * force: تجاوز مهلة الـ 60 ثانية (لمسار cron اليومي).
 */
export async function maintainContractorInvoices(opts?: { force?: boolean }): Promise<ContractorMaintenanceResult> {
  if (maintainState.running) return maintainState.running
  if (!opts?.force && Date.now() - maintainState.lastRunAt < MIN_INTERVAL_MS) {
    return { ran: false, deleted: 0, skipped: 'throttled' }
  }

  maintainState.running = runMaintain()
    .then(function (res) {
      maintainState.lastRunAt = Date.now()
      return res
    })
    .catch(function (err: any) {
      maintainState.lastRunAt = Date.now()
      console.error('[contractor-invoices] maintenance failed:', err)
      return { ran: true, deleted: 0, error: String((err && err.message) || err) } as ContractorMaintenanceResult
    })
    .finally(function () {
      maintainState.running = null
    })

  return maintainState.running
}

async function runMaintain(): Promise<ContractorMaintenanceResult> {
  // حذف كل ما سجلته خوارزمية v114 آلياً (بالبصمة القديمة) — مرة واحدة تكفي،
  // والتكرار لاحقاً يحذف صفراً لأن v116 لا ينشئ بهذه البصمة أبداً.
  var deletedRes = await db.cost.deleteMany({
    where: { notes: { startsWith: CONTRACTOR_LEGACY_MARKER } },
  })
  var deleted = deletedRes.count
  if (deleted > 0) {
    invalidateCachePrefix('dashboard:')
    try {
      await db.auditLog.create({
        data: {
          userId: null,
          action: 'delete',
          entity: 'cost',
          entityId: 'contractor-invoices-legacy-cleanup',
          details: 'تحديث v116: حُذفت ' + deleted + ' فاتورة مقاول كانت تُسجَّل آلياً — وبموجب السياسة الجديدة لا تُسجَّل أي فاتورة إلا بعد إدخال السعر يدوياً واعتمادها من الموظف، والمقترحات تظهر في نافذة فواتير المقاول بقسم الإيرادات والتكاليف.',
        },
      })
    } catch (e) {
      console.error('[contractor-invoices] cleanup audit log failed', e)
    }
  }
  return { ran: true, deleted: deleted }
}

// ════════════════════════════════════════════════════════════
// 2) قائمة المقترحات بانتظار الموافقة (لا تسجيل هنا إطلاقاً)
// ════════════════════════════════════════════════════════════

export interface PendingContractorInvoice {
  /** بصمة المقطع: <معرف الخط>#<رقم المقطع أو tail> */
  token: string
  lineId: string
  lineNumber: string
  projectId: string | null
  projectName: string
  segmentLabel: string
  meters: number
  /** سعر مقترح إرشادي (المقطع × سعر المتر) — النهائي يُدخله الموظف */
  suggestedAmount: number
  dateISO: string
  isFinal: boolean
}

export interface ContractorPendingResult {
  ran: boolean
  pending: PendingContractorInvoice[]
  count: number
  truncated: boolean
  skippedNoPrice: number
  linesChecked: number
  skipped?: 'throttled'
  error?: string
}

const pendingState: {
  lastRunAt: number
  running: Promise<ContractorPendingResult> | null
  last: ContractorPendingResult | null
} = { lastRunAt: 0, running: null, last: null }

/**
 * حساب مقترحات فواتير المقاول غير المعتمدة بعد (قراءة فقط — لا
 * تسجيل). عند التقييد الزمني تُعاد آخر نتيجة ناجحة بدل قائمة فارغة
 * حتى لا تظهر النافذة خالية زوراً.
 */
export async function listPendingContractorInvoices(opts?: { force?: boolean }): Promise<ContractorPendingResult> {
  if (pendingState.running) return pendingState.running
  if (!opts?.force && Date.now() - pendingState.lastRunAt < MIN_INTERVAL_MS && pendingState.last) {
    var cached = pendingState.last
    return Object.assign({}, cached, { ran: false, skipped: 'throttled' as const })
  }

  pendingState.running = runPending()
    .then(function (res) {
      pendingState.lastRunAt = Date.now()
      pendingState.last = res
      return res
    })
    .catch(function (err: any) {
      pendingState.lastRunAt = Date.now()
      console.error('[contractor-invoices] pending list failed:', err)
      return {
        ran: true, pending: [], count: 0, truncated: false,
        skippedNoPrice: 0, linesChecked: 0,
        error: String((err && err.message) || err),
      } as ContractorPendingResult
    })
    .finally(function () {
      pendingState.running = null
    })

  return pendingState.running
}

async function runPending(): Promise<ContractorPendingResult> {
  var result: ContractorPendingResult = {
    ran: true, pending: [], count: 0, truncated: false, skippedNoPrice: 0, linesChecked: 0,
  }

  // 1) الخطوط والمشاريع (سعر المتر الاحتياطي + اسم المشروع للعرض)
  var lines = await db.driveLine.findMany({
    select: {
      id: true, projectId: true, lineNumber: true, totalLength: true,
      pricePerMeter: true, status: true, completedLength: true,
      drillingEndDate: true, updatedAt: true,
    },
    take: 5000,
  })
  var projects = await db.project.findMany({ select: { id: true, pricePerMeter: true, name: true }, take: 5000 })
  var projectInfo: Record<string, { price: number | null; name: string }> = {}
  for (var p of projects) projectInfo[p.id] = { price: p.pricePerMeter, name: p.name }

  // 2) تقارير الحفر لكل الخطوط — قارئ واحد ثم تجميع في الذاكرة
  var reports = await db.dailyReport.findMany({
    where: { driveLineId: { not: null } },
    select: { driveLineId: true, reportDate: true, startReading: true, endReading: true, dailyMeters: true },
    orderBy: { reportDate: 'asc' },
    take: 50000,
  })
  var reportsByLine: Record<string, LineReportRow[]> = {}
  var maxEndByLine: Record<string, number> = {}
  var sumStoredDailyByLine: Record<string, number> = {}
  for (var r of reports) {
    var lineId = String(r.driveLineId || '')
    if (!lineId) continue
    var endReading = r.endReading || 0
    if (endReading > (maxEndByLine[lineId] || 0)) maxEndByLine[lineId] = endReading
    sumStoredDailyByLine[lineId] = (sumStoredDailyByLine[lineId] || 0) + (r.dailyMeters || 0)
    var inc = roundMeters(Math.max(0, endReading - (r.startReading || 0)))
    if (inc <= 0 && (r.dailyMeters || 0) > 0) inc = roundMeters(r.dailyMeters)
    if (!reportsByLine[lineId]) reportsByLine[lineId] = []
    reportsByLine[lineId].push({ date: new Date(r.reportDate), inc: inc })
  }
  for (var key of Object.keys(reportsByLine)) {
    reportsByLine[key].sort(function (a, b) { return a.date.getTime() - b.date.getTime() })
  }

  // 3) المقاطع المعتمدة يدوياً (بالبصمة الجديدة) — لا تُقترح مرة أخرى
  var approvedRows = await db.cost.findMany({
    where: { notes: { startsWith: CONTRACTOR_INVOICE_MARKER } },
    select: { notes: true },
    take: 20000,
  })
  var approvedTokens = new Set<string>()
  for (var row of approvedRows) {
    var tok = parseApprovedToken(row.notes)
    if (tok) approvedTokens.add(tok)
  }

  // 4) توليد المقترحات لكل خط من بياناته الحالية
  var segLen = CONTRACTOR_SEGMENT_METERS
  for (var line of lines) {
    result.linesChecked++
    var lineReports = reportsByLine[line.id] || []

    // الأمتار المحفورة — نفس صيغة recalc-all المعتمدة في النظام
    var drilled = roundMeters(Math.max(
      maxEndByLine[line.id] || 0,
      sumIncrements(lineReports),
      sumStoredDailyByLine[line.id] || 0
    ))
    // خطوط قديمة بلا أي تقارير: خط مكتمل = طوله الكلي واقعياً، وإلا الطول المنجز المخزن
    if (lineReports.length === 0) {
      if (line.status === 'completed' && (line.totalLength || 0) > 0) {
        drilled = roundMeters(line.totalLength)
      } else if ((line.completedLength || 0) > 0) {
        drilled = roundMeters(line.completedLength)
      }
    }
    if (drilled <= 0.005) continue

    var price = line.pricePerMeter != null ? line.pricePerMeter : (projectInfo[line.projectId] ? projectInfo[line.projectId].price : null)
    if (price == null || price <= 0) {
      result.skippedNoPrice++
      continue
    }

    var isCompleted = line.status === 'completed' || ((line.totalLength || 0) > 0 && drilled >= line.totalLength - 0.005)
    var fullCount = Math.floor(drilled / segLen + 1e-9)
    var remainder = roundMeters(drilled - fullCount * segLen)
    var fallbackDate: Date = line.drillingEndDate || line.updatedAt || new Date()
    var projName = line.projectId && projectInfo[line.projectId] ? projectInfo[line.projectId].name : ''

    // مقترح لكل مقطع كامل — تاريخه يوم عبور نهاية المقطع
    for (var k = 1; k <= fullCount; k++) {
      var token = line.id + '#' + k
      if (approvedTokens.has(token)) continue
      var from = roundMeters((k - 1) * segLen)
      var to = roundMeters(k * segLen)
      result.pending.push({
        token: token,
        lineId: line.id,
        lineNumber: line.lineNumber,
        projectId: line.projectId,
        projectName: projName,
        segmentLabel: 'المقطع ' + k + ' — من ' + from + ' إلى ' + to + ' متر',
        meters: segLen,
        suggestedAmount: roundMoney(segLen * price),
        dateISO: (crossingDate(lineReports, k * segLen) || fallbackDate).toISOString(),
        isFinal: false,
      })
    }

    // الخط المنتهي: مقترح أخير للباقي غير المكتمل (مثال: 47 م = 4 مقترحات + 7 م)
    if (isCompleted && remainder > 0.005) {
      var tailToken = line.id + '#tail'
      if (!approvedTokens.has(tailToken)) {
        result.pending.push({
          token: tailToken,
          lineId: line.id,
          lineNumber: line.lineNumber,
          projectId: line.projectId,
          projectName: projName,
          segmentLabel: 'المقطع الأخير — من ' + roundMeters(fullCount * segLen) + ' إلى ' + drilled + ' متر',
          meters: remainder,
          suggestedAmount: roundMoney(remainder * price),
          dateISO: (lineReports.length > 0 ? lineReports[lineReports.length - 1].date : fallbackDate).toISOString(),
          isFinal: true,
        })
      }
    }
  }

  // 5) ترتيب مفهوم للموظف: رقم الخط تصاعدياً ثم رقم المقطع (الأخير في النهاية)
  function segOrder(inv: PendingContractorInvoice): number {
    if (inv.isFinal) return Number.MAX_SAFE_INTEGER
    var n = parseInt(inv.token.slice(inv.token.indexOf('#') + 1), 10)
    return Number.isFinite(n) ? n : 0
  }
  result.pending.sort(function (a, b) {
    var lineCmp = String(a.lineNumber).localeCompare(String(b.lineNumber), undefined, { numeric: true })
    if (lineCmp !== 0) return lineCmp
    return segOrder(a) - segOrder(b)
  })

  result.count = result.pending.length
  if (result.pending.length > MAX_PENDING_RETURNED) {
    result.pending = result.pending.slice(0, MAX_PENDING_RETURNED)
    result.truncated = true
  }
  return result
}

// ════════════════════════════════════════════════════════════
// 3) الاعتماد اليدوي — إدخال السعر + موافقة الموظف ثم التسجيل
// ════════════════════════════════════════════════════════════

export interface ApproveContractorInvoiceResult {
  ok: boolean
  duplicate?: boolean
  expired?: boolean
  costId?: string
  message?: string
}

interface SingleProposal {
  projectId: string | null
  date: Date
  description: string
  meters: number
  suggestedAmount: number
}

/**
 * إعادة حساب مقترح مقطع واحد ببيانات الحفر الحالية — حماية من
 * اعتماد مقطع تغيّرت بياناته (تصحيح قراءات / حذف خط / نزول أمتار).
 */
async function computeSingleLineProposal(lineId: string, segKey: string): Promise<{ ok: true; proposal: SingleProposal } | { ok: false; reason: string; expired: boolean }> {
  var line = await db.driveLine.findUnique({
    where: { id: lineId },
    select: {
      id: true, projectId: true, lineNumber: true, totalLength: true,
      pricePerMeter: true, status: true, completedLength: true,
      drillingEndDate: true, updatedAt: true,
    },
  })
  if (!line) return { ok: false, reason: 'خط الحفر غير موجود — ربما حُذف من النظام، حدث القائمة', expired: true }

  var projectPrice: number | null = null
  if (line.projectId) {
    var proj = await db.project.findUnique({ where: { id: line.projectId }, select: { pricePerMeter: true } })
    projectPrice = proj ? proj.pricePerMeter : null
  }
  var price = line.pricePerMeter != null ? line.pricePerMeter : projectPrice
  if (price == null || price <= 0) {
    return { ok: false, reason: 'لا يوجد سعر متر لهذا الخط ولا لمشروعه — أدخل سعر المتر أولاً ثم أعد الاعتماد', expired: false }
  }

  var reps = await db.dailyReport.findMany({
    where: { driveLineId: lineId },
    select: { reportDate: true, startReading: true, endReading: true, dailyMeters: true },
    orderBy: { reportDate: 'asc' },
    take: 5000,
  })
  var rows: LineReportRow[] = []
  var maxEnd = 0
  var sumStored = 0
  for (var i = 0; i < reps.length; i++) {
    var rr = reps[i]
    var endReading = rr.endReading || 0
    if (endReading > maxEnd) maxEnd = endReading
    sumStored += rr.dailyMeters || 0
    var inc = roundMeters(Math.max(0, endReading - (rr.startReading || 0)))
    if (inc <= 0 && (rr.dailyMeters || 0) > 0) inc = roundMeters(rr.dailyMeters)
    rows.push({ date: new Date(rr.reportDate), inc: inc })
  }
  rows.sort(function (a, b) { return a.date.getTime() - b.date.getTime() })

  var drilled = roundMeters(Math.max(maxEnd, sumIncrements(rows), sumStored))
  if (rows.length === 0) {
    if (line.status === 'completed' && (line.totalLength || 0) > 0) drilled = roundMeters(line.totalLength)
    else if ((line.completedLength || 0) > 0) drilled = roundMeters(line.completedLength)
  }
  if (drilled <= 0.005) return { ok: false, reason: 'لا يوجد حفر مسجل لهذا الخط بعد', expired: true }

  var segLen = CONTRACTOR_SEGMENT_METERS
  var isCompleted = line.status === 'completed' || ((line.totalLength || 0) > 0 && drilled >= line.totalLength - 0.005)
  var fullCount = Math.floor(drilled / segLen + 1e-9)
  var remainder = roundMeters(drilled - fullCount * segLen)
  var fallbackDate: Date = line.drillingEndDate || line.updatedAt || new Date()

  if (segKey === 'tail') {
    if (!isCompleted || remainder <= 0.005) {
      return { ok: false, reason: 'الفاتورة الأخيرة لم تعد مطلوبة — بيانات الحفر تغيرت، حدث القائمة', expired: true }
    }
    return { ok: true, proposal: {
      projectId: line.projectId,
      date: rows.length > 0 ? rows[rows.length - 1].date : fallbackDate,
      description: 'فاتورة المقاول — خط ' + line.lineNumber + ': المقطع الأخير — من ' + roundMeters(fullCount * segLen) + ' إلى ' + drilled + ' متر',
      meters: remainder,
      suggestedAmount: roundMoney(remainder * price),
    } }
  }

  var k = parseInt(segKey, 10)
  if (!(k >= 1 && k <= fullCount)) {
    return { ok: false, reason: 'هذا المقطع لم يعد ضمن الأمتار المحفورة — بيانات الحفر تغيرت، حدث القائمة', expired: true }
  }
  var from = roundMeters((k - 1) * segLen)
  var to = roundMeters(k * segLen)
  return { ok: true, proposal: {
    projectId: line.projectId,
    date: crossingDate(rows, k * segLen) || fallbackDate,
    description: 'فاتورة المقاول — خط ' + line.lineNumber + ': المقطع ' + k + ' — من ' + from + ' إلى ' + to + ' متر',
    meters: segLen,
    suggestedAmount: roundMoney(segLen * price),
  } }
}

/**
 * اعتماد مقترح فاتورة: السعر يُدخله الموظف يدوياً وبعد الموافقة
 * تُسجَّل الفاتورة ضمن التكاليف (وبها بصمة تمنع اقتراح المقطع مجدداً).
 */
export async function approveContractorInvoice(opts: { token: string; amount: number; userId: string }): Promise<ApproveContractorInvoiceResult> {
  try {
    var token = String(opts.token || '')
    var hashIndex = token.indexOf('#')
    if (hashIndex <= 0 || hashIndex !== token.lastIndexOf('#')) {
      return { ok: false, message: 'بصمة الفاتورة غير صالحة — حدث القائمة وأعد المحاولة' }
    }
    var lineId = token.slice(0, hashIndex)
    var segKey = token.slice(hashIndex + 1)
    if (!lineId || !(segKey === 'tail' || /^[1-9][0-9]*$/.test(segKey))) {
      return { ok: false, message: 'بصمة الفاتورة غير صالحة — حدث القائمة وأعد المحاولة' }
    }
    var amount = Number(opts.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
      return { ok: false, message: 'السعر يجب أن يكون رقماً موجباً ومعقولاً (أقل من 10,000,000)' }
    }

    // معتمد مسبقاً؟ (نقر مزدوج أو اعتماد متزامن من نافذة أخرى)
    var existing = await db.cost.findFirst({
      where: { notes: CONTRACTOR_INVOICE_MARKER + token },
      select: { id: true },
    })
    if (existing) return { ok: true, duplicate: true, costId: existing.id }

    var computed = await computeSingleLineProposal(lineId, segKey)
    if (!computed.ok) {
      return { ok: false, message: computed.reason, expired: computed.expired }
    }
    var prop = computed.proposal

    var created = await db.cost.create({
      data: {
        projectId: prop.projectId,
        date: prop.date,
        category: CONTRACTOR_COST_CATEGORY,
        description: prop.description,
        amount: roundMoney(amount),
        notes: CONTRACTOR_INVOICE_MARKER + token,
        recordedById: opts.userId,
      },
    })

    // حماية تزامن: لو أُنشئت نسختان لنفس المقطع يُبقى الأقدم فقط
    var sameToken = await db.cost.findMany({
      where: { notes: CONTRACTOR_INVOICE_MARKER + token },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    if (sameToken.length > 1) {
      var staleIds = sameToken.slice(1).map(function (r) { return r.id })
      await db.cost.deleteMany({
        where: { id: { in: staleIds }, notes: CONTRACTOR_INVOICE_MARKER + token },
      })
    }

    invalidateCachePrefix('dashboard:')
    try {
      await db.auditLog.create({
        data: {
          userId: opts.userId,
          projectId: prop.projectId,
          action: 'create',
          entity: 'cost',
          entityId: created.id,
          details: 'اعتماد فاتورة مقاول: ' + prop.description + ' — المبلغ ' + roundMoney(amount) + ' ر.ع (سعر مُدخل يدوياً واعتمده الموظف)',
        },
      })
    } catch (e) {
      console.error('[contractor-invoices] approve audit log failed', e)
    }
    try {
      await notifyUsers({
        type: 'contractor_invoice_approved',
        title: 'فاتورة مقاول معتمدة',
        message: 'سُجلت فاتورة مقاول بعد اعتماد يدوي: ' + prop.description + ' — المبلغ ' + roundMoney(amount) + ' ر.ع (دخله الموظف يدوياً ثم وافق عليها).',
        severity: 'info',
        projectId: prop.projectId,
        entityType: 'cost',
        entityId: created.id,
        permissions: ['costs'],
        roles: ['top_management', 'project_manager', 'accountant'],
        excludeUserIds: [opts.userId],
        includeSystemAdmin: true,
        link: 'costs',
      })
    } catch (e) {
      console.error('[contractor-invoices] approve notify failed', e)
    }

    return { ok: true, costId: created.id }
  } catch (err: any) {
    console.error('[contractor-invoices] approve failed:', err)
    return { ok: false, message: 'تعذر تسجيل الفاتورة — أعد المحاولة' }
  }
}
