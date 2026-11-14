// ============================================================
// v114 — خوارزمية «فاتورة المقاول» الآلية
// AXIS Pipe Jacking Management System
// ============================================================
// الفكرة:
//   كل 10 أمتار محفورة في أي خط حفر = فاتورة تكلفة واحدة باسم
//   «فاتورة المقاول» تُسجَّل آلياً في قسم الإيرادات والتكاليف
//   (جدول Cost الحالي) دون أي تدخل بشري — وتعمل رجعياً على
//   الخطوط القديمة والمنتهية من أول تشغيل.
//
// قواعد الحساب:
//   1) الأمتار المحفورة لكل خط = نفس الطريقة المعتمدة في النظام
//      (أقصى endReading أو مجموع الأمتار اليومية من تقارير الخط) —
//      وهي نفسها التي تظهر كنسبة إنجاز في قسم خطوط الحفر.
//   2) سعر المتر = سعر متر الخط، وإن كان فارغاً يُلجأ لسعر متر
//      المشروع (نفس قاعدة حساب الإيراد). خط بلا سعر إطلاقاً =
//      يُتخطى حتى يُدخل سعره ثم تصدر فواتيره في المزامنة التالية.
//   3) كل مقطع كامل (10 م) = فاتورة بمبلغ 10 × سعر المتر، وتاريخها
//      هو تاريخ التقرير اليومي الذي عبر فيه الحفر نهاية المقطع
//      (فالفواتير القديمة تأخذ تواريخها الحقيقية من تقاريرها).
//   4) الخط المنتهي (حالته «مكتمل» أو وصل الحفر طوله الكلي) يصدر
//      فاتورة أخيرة للباقي غير المكتمل — مثال: 47 م مكتمل =
//      4 فواتير كاملة (10+10+10+10 م) + فاتورة أخيرة لـ 7 أمتار.
//   5) خطوط قديمة مكتملة بلا أي تقارير: يُعتمد طولها الكلي كمقدار
//      حفر (وهو الواقع الهندسي لخط منتهٍ) حتى لا تفوتهم الفواتير.
//
// منع التكرار (Idempotency):
//   كل فاتورة آلية تحمل في حقل الملاحظات بصمة ثابتة بالشكل:
//   «فاتورة مقاول آلية #<معرف الخط>#<رقم المقطع أو tail>»
//   المزامنة تقارن المطلوب بالموجود فتُنشئ الناقص فقط، وتصحح
//   مبالغ/تواريخ/أوصاف ما تغيّرت بياناته، وتحذف الزائد (بعد تصحيح
//   قراءات نزّل الأمتار أو حذف خط) وتنظف أي نسخ مكررة نتجت عن
//   تزامن لحظي بين خادمَين. الفواتير اليدوية (بلا البصمة) لا تُمس
//   نهائياً.
//
// التشغيل التلقائي:
//   - عند فتح قسم الإيرادات والتكاليف (قبل الجلب مباشرة)
//   - عند فتح قسم خطوط الحفر
//   - عبر مسار cron يومي: GET /api/cron/contractor-invoices (vercel.json)
//   مقيَّدة بـ 60 ثانية بين التشغيلات داخل نفس الخادم + قفل تشغيل واحد،
//   وأي خطأ داخلي لا يُفشل العملية المستدعية أبداً.
// ============================================================

import { db, invalidateCachePrefix } from '@/lib/db'
import { roundMeters, roundMoney } from '@/lib/api-helpers'
import { notifyUsers } from '@/lib/notify'

/** طول المقطع الواحد الذي تصدر عنه فاتورة (بالأمتار) */
export const CONTRACTOR_SEGMENT_METERS = 10

/**
 * البصمة الثابتة في حقل ملاحظات الفاتورة الآلية.
 * تحذير: لا تعدّل نصها بعد الإطلاق — بها تُعرَّف فواتير النظام
 * ولا تُمس الفواتير اليدوية.
 */
export const CONTRACTOR_INVOICE_MARKER = 'فاتورة مقاول آلية #'

/** فئة التكلفة المخصصة لفواتير المقاول الآلية */
export const CONTRACTOR_COST_CATEGORY = 'contractor'

export interface ContractorInvoiceSyncResult {
  ran: boolean
  created: number
  updated: number
  deleted: number
  createdAmount: number
  linesChecked: number
  skippedNoPrice: number
  skipped?: 'throttled'
  error?: string
}

interface LineReportRow {
  date: Date
  inc: number
}

interface NeededInvoice {
  projectId: string | null
  segKey: string
  amount: number
  date: Date
  description: string
}

// ── حالة المزامنة داخل الخادم (منع الازدواج والاندفاع) ──
const syncState: { lastRunAt: number; running: Promise<ContractorInvoiceSyncResult> | null } = {
  lastRunAt: 0,
  running: null,
}
const MIN_INTERVAL_MS = 60_000

/**
 * تشغيل مزامنة فواتير المقاول (آمنة للاستدعاء المتكرر).
 * - force: تجاوز مهلة الـ 60 ثانية (لمسار cron اليومي).
 */
export async function syncContractorInvoices(opts?: { force?: boolean }): Promise<ContractorInvoiceSyncResult> {
  if (syncState.running) return syncState.running
  if (!opts?.force && Date.now() - syncState.lastRunAt < MIN_INTERVAL_MS) {
    return { ran: false, created: 0, updated: 0, deleted: 0, createdAmount: 0, linesChecked: 0, skippedNoPrice: 0, skipped: 'throttled' }
  }

  syncState.running = runSync()
    .then(function (res) {
      syncState.lastRunAt = Date.now()
      return res
    })
    .catch(function (err: any) {
      syncState.lastRunAt = Date.now()
      console.error('[contractor-invoices] sync failed:', err)
      return {
        ran: true, created: 0, updated: 0, deleted: 0, createdAmount: 0,
        linesChecked: 0, skippedNoPrice: 0,
        error: String((err && err.message) || err),
      } as ContractorInvoiceSyncResult
    })
    .finally(function () {
      syncState.running = null
    })

  return syncState.running
}

// ── أدوات حسابية صرفة ──

function sumIncrements(rows: LineReportRow[]): number {
  var total = 0
  for (var i = 0; i < rows.length; i++) total += rows[i].inc
  return total
}

/** تاريخ أول تقرير عبر فيه الحفر التراكمي حدّ targetMeters (تاريخ إصدار الفاتورة الطبيعي) */
function crossingDate(rows: LineReportRow[], targetMeters: number): Date | null {
  var cumulative = 0
  for (var i = 0; i < rows.length; i++) {
    cumulative = roundMeters(cumulative + rows[i].inc)
    if (cumulative >= targetMeters - 0.005) return rows[i].date
  }
  return null
}

/** استخراج بصمة الفاتورة الآلية من نص الملاحظات — null يعني «ليست فاتورة آلية» */
function parseAutoToken(notes: string | null | undefined): string | null {
  if (!notes || notes.indexOf(CONTRACTOR_INVOICE_MARKER) !== 0) return null
  var rest = notes.slice(CONTRACTOR_INVOICE_MARKER.length)
  return rest.length > 0 ? rest : null
}

// ── جسم المزامنة ──

async function runSync(): Promise<ContractorInvoiceSyncResult> {
  var result: ContractorInvoiceSyncResult = { ran: true, created: 0, updated: 0, deleted: 0, createdAmount: 0, linesChecked: 0, skippedNoPrice: 0 }

  // 1) الخطوط وأسعار المشاريع (الاحتياطي) — قراءتان خفيفتان
  var lines = await db.driveLine.findMany({
    select: {
      id: true, projectId: true, lineNumber: true, totalLength: true,
      pricePerMeter: true, status: true, completedLength: true,
      drillingEndDate: true, updatedAt: true,
    },
    take: 5000,
  })
  var projects = await db.project.findMany({ select: { id: true, pricePerMeter: true }, take: 5000 })
  var projectPrice: Record<string, number | null> = {}
  for (var p of projects) projectPrice[p.id] = p.pricePerMeter

  // 2) تقارير الحفر لكل الخطوط — قارئ واحد ثم تجميع في الذاكرة
  //    (نفس اتفاقية النظام: أقصى endReading أو مجموع الأمتار اليومية)
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

  // 3) الفواتير الآلية الموجودة حالياً (بالبصمة) — خريطة البصمة → صفوفها
  var existingRows = await db.cost.findMany({
    where: { notes: { startsWith: CONTRACTOR_INVOICE_MARKER } },
    select: { id: true, notes: true, amount: true, description: true, date: true, createdAt: true },
    take: 20000,
  })
  var tokenToRows = new Map<string, Array<{ id: string; amount: number; description: string; date: Date; createdAt: Date }>>()
  for (var row of existingRows) {
    var token = parseAutoToken(row.notes)
    if (!token) continue // بصمة تالفة (فارغة بعد #) — تُترك ولا تُمس
    if (!tokenToRows.has(token)) tokenToRows.set(token, [])
    tokenToRows.get(token)!.push({ id: row.id, amount: row.amount, description: row.description, date: row.date, createdAt: row.createdAt })
  }
  // نسخ مكررة لنفس البصمة (نتيجة تزامن لحظي) — يُبقى الأقدم ويُحذف البقية
  var duplicateIds: string[] = []
  var existingTokens = new Set<string>()
  tokenToRows.forEach(function (rowsArr, tok) {
    existingTokens.add(tok)
    if (rowsArr.length > 1) {
      rowsArr.sort(function (a, b) { return a.createdAt.getTime() - b.createdAt.getTime() })
      for (var d = 1; d < rowsArr.length; d++) duplicateIds.push(rowsArr[d].id)
    }
  })

  // 4) حساب الفواتير المطلوبة لكل خط من بياناته الحالية
  var needed = new Map<string, NeededInvoice>()
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

    var price = line.pricePerMeter != null ? line.pricePerMeter : (projectPrice[line.projectId] != null ? projectPrice[line.projectId] : null)
    if (price == null || price <= 0) {
      result.skippedNoPrice++
      continue
    }

    var isCompleted = line.status === 'completed' || ((line.totalLength || 0) > 0 && drilled >= line.totalLength - 0.005)
    var fullCount = Math.floor(drilled / segLen + 1e-9)
    var remainder = roundMeters(drilled - fullCount * segLen)
    var fallbackDate: Date = line.drillingEndDate || line.updatedAt || new Date()

    // فاتورة لكل مقطع كامل — تاريخها يوم عبور نهاية المقطع
    for (var k = 1; k <= fullCount; k++) {
      var from = roundMeters((k - 1) * segLen)
      var to = roundMeters(k * segLen)
      needed.set(line.id + '#' + k, {
        projectId: line.projectId,
        segKey: String(k),
        amount: roundMoney(segLen * price),
        date: crossingDate(lineReports, k * segLen) || fallbackDate,
        description: 'فاتورة المقاول — خط ' + line.lineNumber + ': المقطع ' + k + ' — من ' + from + ' إلى ' + to + ' متر',
      })
    }

    // الخط المنتهي: فاتورة أخيرة للباقي غير المكتمل (مثال: 47 م = 4 فواتير + 7 م)
    if (isCompleted && remainder > 0.005) {
      needed.set(line.id + '#tail', {
        projectId: line.projectId,
        segKey: 'tail',
        amount: roundMoney(remainder * price),
        date: lineReports.length > 0 ? lineReports[lineReports.length - 1].date : fallbackDate,
        description: 'فاتورة المقاول — خط ' + line.lineNumber + ': المقطع الأخير — من ' + roundMeters(fullCount * segLen) + ' إلى ' + drilled + ' متر',
      })
    }
  }

  // 5) المطابقة: إنشاء الناقص + تصحيح المتغير + حذف الزائد والمكرر
  var toCreate: Array<{
    projectId: string | null
    date: Date
    category: string
    description: string
    amount: number
    notes: string
  }> = []
  var toUpdate: Array<{ id: string; amount: number; date: Date; description: string }> = []
  var toDeleteIds = duplicateIds.slice()

  needed.forEach(function (inv, tok) {
    var existingArr = tokenToRows.get(tok)
    if (!existingArr || existingArr.length === 0) {
      toCreate.push({
        projectId: inv.projectId,
        date: inv.date,
        category: CONTRACTOR_COST_CATEGORY,
        description: inv.description,
        amount: inv.amount,
        notes: CONTRACTOR_INVOICE_MARKER + tok,
      })
      return
    }
    var cur = existingArr[0]
    var amountChanged = Math.abs((cur.amount || 0) - inv.amount) > 0.005
    var dateChanged = Math.abs(cur.date.getTime() - inv.date.getTime()) > 60_000
    var descChanged = cur.description !== inv.description
    if (amountChanged || dateChanged || descChanged) {
      toUpdate.push({ id: cur.id, amount: inv.amount, date: inv.date, description: inv.description })
    }
  })
  // فواتير آلية لم تعد مطلوبة (تصحيح قراءات نزل الأمتار / خط محذوف / خط لم يعد منتهياً)
  existingTokens.forEach(function (tok) {
    if (!needed.has(tok)) {
      var arr = tokenToRows.get(tok) || []
      for (var j = 0; j < arr.length; j++) toDeleteIds.push(arr[j].id)
    }
  })

  if (toCreate.length > 0) {
    var createdRes = await db.cost.createMany({ data: toCreate })
    result.created = createdRes.count
    var sum = 0
    for (var c of toCreate) sum += c.amount
    result.createdAmount = roundMoney(sum)
  }

  for (var u of toUpdate) {
    try {
      await db.cost.update({
        where: { id: u.id },
        data: { amount: u.amount, date: u.date, description: u.description },
      })
      result.updated++
    } catch (e) {
      // الفاتورة ربما حُذفت يدوياً للحظة — تُلتقط في التشغيل التالي
      console.error('[contractor-invoices] update failed for cost ' + u.id, e)
    }
  }

  if (toDeleteIds.length > 0) {
    // حزام أمان مضاعف: لا يُحذف إلا صف يحمل البصمة فعلاً
    var deletedRes = await db.cost.deleteMany({
      where: { id: { in: toDeleteIds }, notes: { startsWith: CONTRACTOR_INVOICE_MARKER } },
    })
    result.deleted = deletedRes.count
  }

  // 6) آثار جانبية عند أي تغيير: إبطال ذاكرة لوحة التحكم + سجل تدقيق ملخص + تنبيه واحد
  if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
    invalidateCachePrefix('dashboard:')
    try {
      await db.auditLog.create({
        data: {
          userId: null,
          action: result.created > 0 ? 'create' : 'update',
          entity: 'cost',
          entityId: 'contractor-invoices-auto',
          details: 'خوارزمية فاتورة المقاول: أُصدرت ' + result.created + ' فاتورة آلية بقيمة ' + result.createdAmount + ' ر.ع، صُححت ' + result.updated + '، حُذفت ' + result.deleted + ' غير مطابقة — فُحص ' + result.linesChecked + ' خط حفر (منها ' + result.skippedNoPrice + ' بلا سعر متر)',
        },
      })
    } catch (e) {
      console.error('[contractor-invoices] audit log failed', e)
    }
    if (result.created > 0) {
      await notifyUsers({
        type: 'contractor_invoice_auto',
        title: 'فواتير مقاول آلية جديدة',
        message: 'أصدر النظام تلقائياً ' + result.created + ' فاتورة مقاول بقيمة ' + result.createdAmount + ' ر.ع (فاتورة لكل 10 أمتار من خطوط الحفر) وسجلها ضمن التكاليف في قسم الإيرادات والتكاليف.',
        severity: 'info',
        entityType: 'cost',
        entityId: 'contractor-invoices-auto',
        permissions: ['costs'],
        roles: ['top_management', 'project_manager', 'accountant'],
        includeSystemAdmin: true,
        link: 'costs',
        dedupeHours: 24,
      })
    }
  }

  return result
}
