// ============================================================
// v123 — مستحقات مقاولي الحفر النفقي: المحرك الموحّد
// AXIS Pipe Jacking Management System
// ============================================================
// يستبدل آلية «فاتورة لكل 10 أمتار» (v114/v116) الملغاة بالكامل.
// المبادئ الثابتة:
//   1) المستحقات تُحتسب حصرياً من طول الحفر المنفذ فعلياً (Actual
//      Excavated Length) المسجل في التقارير اليومية المعتمدة —
//      طول الأنابيب المدفوعة (Pipe Jacked Length) يُسجَّل مستقلاً
//      ويُعرض للمراجعة الفنية فقط ولا يدخل الاحتساب إطلاقاً.
//   2) لا فواتير متكررة: التحديث اليومي يرفع المستحقات التراكمية
//      للخط نفسه فقط. مسودة فاتورة واحدة لكل خط مكتمل ومعتمد
//      فنياً، ويُخصم ما سبق اعتماده/تسويته إجبارياً من أي مستحق جديد.
//   3) إعادة حساب دائمة من المصدر: كل قراءة تعيد الجمع من صفوف
//      التقارير نفسها — تعديل تقرير أو إعادة حفظه لا يضاعف شيئاً
//      ولا يولّد فاتورة جديدة.
//   4) ما سبق صرفه لا يُعاد احتسابه أبداً: أطوال فواتير المقاول
//      القديمة المعتمدة (ترحيل v123) محفوظة على الخط في
//      settledOldLength/settledOldAmount وتُخصم من كل مستحق جديد.
//   5) العملة العمانية بثلاث خانات عشرية في كل مبلغ يخرج من هنا.
//   6) لا تجاوز للطول المخطط دون تعديل معتمد: تجاوز الحفر للطول
//      المخطط (أو لآخر تعديل معتمد له) يُحذَر ولا يدخل المستحقات
//      إلا بعد تسجيل «تعديل طول مخطط معتمد» من الإدارة.
// ============================================================

import { db } from '@/lib/db'
import { notifyUsers } from '@/lib/notify'
import { ensureContractorDuesSupport } from '@/lib/db-selfheal'

// حالات الفاتورة النشطة — وجود أي منها يمنع إنشاء فاتورة ثانية لنفس الخط
export var INVOICE_ACTIVE_STATUSES = ['pending_financial', 'pending_final', 'approved', 'partially_paid', 'paid']
// حالات الفاتورة التي يُعدّ مبلغها «معتمداً مالياً»
export var INVOICE_SETTLED_STATUSES = ['approved', 'partially_paid', 'paid']

// العملة العمانية بثلاث خانات عشرية — كل مبلغ يمر من هنا
export function round3(n: number): number {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

export interface LineDues {
  driveLineId: string
  projectId: string
  projectName: string
  lineNumber: string
  diameter: string
  status: string
  plannedLength: number
  approvedPlannedLength: number   // الطول المخطط بعد آخر تعديل معتمد (إن وجد)
  hasLengthExtension: boolean     // هل سُمح بتجاوز الطول الأصلي بتعديل معتمد؟
  contractorName: string
  pricePerMeter: number
  plannedStartDate: string | null
  hasAgreement: boolean           // عقد مكتمل: اسم مقاول + سعر متر
  excavatedLength: number         // طول الحفر المنفذ فعلياً (من التقارير المعتمدة)
  pipeJackedLength: number        // طول الأنابيب المدفوعة — للمراجعة الفنية فقط
  countedLength: number           // الطول المعتمد للاحتساب (محدود بالسقف المسموح)
  overLimit: boolean              // هل تجاوز الحفر الفعلي السقف المسموح دون تعديل معتمد؟
  accruedAmount: number           // إجمالي المستحقات التراكمية (counted × السعر)
  settledOldLength: number        // أطوال الفواتير القديمة المعتمدة (ترحيل v123)
  settledOldAmount: number
  newInvoicedLength: number       // أطوال فواتير v123 المعتمدة مالياً
  approvedNewAmount: number
  paidAmount: number              // الدفعات المسجلة على فواتير v123
  previouslyApprovedAmount: number // المعتمد سابقاً كلياً (قديم + جديد)
  uninvoicedLength: number        // الحفر غير المفوتر بعد
  uninvoicedAmount: number
  balance: number                 // المعتمد وغير المدفوع (فواتير v123)
  activeInvoice: { id: string; invoiceNo: string; status: string; netAmount: number } | null
  canRequestVerification: boolean
  lastChanges: Array<{ id: string; changeType: string; oldValue: number; newValue: number; reason: string; approvedByName: string | null; createdAt: string }>
}

// محرك القراءة الموحّد — يعيد حساب كل خط من المصدر (لا قيم مخزنة قديمة)
export async function computeAllContractorDues(): Promise<{ lines: LineDues[]; invoices: any[] }> {
  await ensureContractorDuesSupport()

  var lines = await db.driveLine.findMany({
    include: { project: { select: { name: true, code: true } } },
    orderBy: [{ projectId: 'asc' }, { lineNumber: 'asc' }],
  })
  if (lines.length === 0) return { lines: [], invoices: [] }

  // إجمالي الحفر الفعلي وطول الأنابيب من التقارير المعتمدة — استعلام واحد مجمّع
  var reportAgg = await db.dailyReport.groupBy({
    by: ['driveLineId'],
    where: { status: 'approved', driveLineId: { not: null } },
    _sum: { dailyMeters: true, pipeJackedMeters: true },
  })
  var reportMap: Record<string, { excavated: number; piped: number }> = {}
  for (var r of reportAgg) {
    if (!r.driveLineId) continue
    reportMap[r.driveLineId] = {
      excavated: r._sum.dailyMeters || 0,
      piped: r._sum.pipeJackedMeters || 0,
    }
  }

  var invoices = await db.contractorInvoice.findMany({
    include: { payments: { orderBy: { paidAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  var changes = await db.contractorLineChange.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })

  var invoicesByLine: Record<string, any[]> = {}
  var changesByLine: Record<string, any[]> = {}
  for (var inv of invoices) {
    (invoicesByLine[inv.driveLineId] = invoicesByLine[inv.driveLineId] || []).push(inv)
  }
  for (var ch of changes) {
    (changesByLine[ch.driveLineId] = changesByLine[ch.driveLineId] || []).push(ch)
  }

  var duesLines: LineDues[] = lines.map(function(line) {
    return buildLineDues(line, reportMap[line.id] || { excavated: 0, piped: 0 }, invoicesByLine[line.id] || [], changesByLine[line.id] || [])
  })

  return { lines: duesLines, invoices: invoices }
}

function buildLineDues(
  line: any,
  agg: { excavated: number; piped: number },
  lineInvoices: any[],
  lineChanges: any[]
): LineDues {
  var price = Number(line.pricePerMeter) || 0
  var planned = Number(line.totalLength) || 0
  var excavated = Math.max(0, Number(agg.excavated) || 0)
  var piped = Math.max(0, Number(agg.piped) || 0)

  // سقف الطول المسموح للاحتساب: الطول المخطط أو آخر «تعديل طول مخطط معتمد»
  var lastExtension = 0
  for (var ch of lineChanges) {
    if (ch.changeType === 'planned_length' && Number(ch.newValue) > lastExtension) lastExtension = Number(ch.newValue)
  }
  var approvedPlanned = lastExtension > 0 ? lastExtension : planned
  var overLimit = excavated > approvedPlanned + 0.0001
  var countedLength = Math.min(excavated, approvedPlanned)

  var settledOldLength = Number(line.settledOldLength) || 0
  var settledOldAmount = Number(line.settledOldAmount) || 0

  var newInvoicedLength = 0
  var approvedNewAmount = 0
  var paidAmount = 0
  var active = null as any
  for (var inv of lineInvoices) {
    if (INVOICE_SETTLED_STATUSES.indexOf(inv.status) !== -1) {
      newInvoicedLength += Number(inv.approvedLength) || 0
      approvedNewAmount += Number(inv.netAmount) || 0
      for (var p of (inv.payments || [])) paidAmount += Number(p.amount) || 0
    }
    if (!active && INVOICE_ACTIVE_STATUSES.indexOf(inv.status) !== -1) {
      active = { id: inv.id, invoiceNo: inv.invoiceNo, status: inv.status, netAmount: Number(inv.netAmount) || 0 }
    }
  }

  var accrued = round3(countedLength * price)
  var previouslyApproved = round3(settledOldAmount + approvedNewAmount)
  var uninvoicedLength = Math.max(0, round3(countedLength - settledOldLength - newInvoicedLength))
  var uninvoicedAmount = round3(uninvoicedLength * price)
  var balance = round3(approvedNewAmount - paidAmount)
  var hasAgreement = !!(line.contractorName && String(line.contractorName).trim() && price > 0)

  return {
    driveLineId: line.id,
    projectId: line.projectId,
    projectName: line.project ? line.project.name : '',
    lineNumber: line.lineNumber,
    diameter: line.diameter,
    status: line.status,
    plannedLength: planned,
    approvedPlannedLength: approvedPlanned,
    hasLengthExtension: lastExtension > 0,
    contractorName: line.contractorName || '',
    pricePerMeter: price,
    plannedStartDate: line.plannedStartDate ? line.plannedStartDate.toISOString() : null,
    hasAgreement: hasAgreement,
    excavatedLength: round3(excavated),
    pipeJackedLength: round3(piped),
    countedLength: round3(countedLength),
    overLimit: overLimit,
    accruedAmount: accrued,
    settledOldLength: round3(settledOldLength),
    settledOldAmount: round3(settledOldAmount),
    newInvoicedLength: round3(newInvoicedLength),
    approvedNewAmount: round3(approvedNewAmount),
    paidAmount: round3(paidAmount),
    previouslyApprovedAmount: previouslyApproved,
    uninvoicedLength: uninvoicedLength,
    uninvoicedAmount: uninvoicedAmount,
    balance: balance,
    activeInvoice: active,
    canRequestVerification: line.status === 'completed' && hasAgreement && !active,
    lastChanges: (lineChanges || []).slice(0, 10).map(function(c) {
      return { id: c.id, changeType: c.changeType, oldValue: Number(c.oldValue) || 0, newValue: Number(c.newValue) || 0, reason: c.reason, approvedByName: c.approvedByName, createdAt: c.createdAt.toISOString() }
    }),
  }
}

// توليد رقم فاتورة فريد: CTR-<الخط>-<تسلسل>-<لاحقة أمان>
async function nextInvoiceNo(lineNumber: string): Promise<string> {
  var safe = String(lineNumber || 'LINE').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'LINE'
  var count = await db.contractorInvoice.count({ where: { driveLineId: { not: '' } } })
  var n = count + 1
  // حلقة أمان ضد تصادم الرقم الفريد (حذف سجلات سابقة مثلاً)
  for (var i = 0; i < 50; i++) {
    var candidate = 'CTR-' + safe + '-' + String(n + i).padStart(4, '0')
    var exists = await db.contractorInvoice.findUnique({ where: { invoiceNo: candidate }, select: { id: true } })
    if (!exists) return candidate
  }
  return 'CTR-' + safe + '-' + Date.now().toString(36).toUpperCase()
}

export interface CreateDraftResult {
  ok: boolean
  status?: number
  error?: string
  message?: string
  invoice?: any
}

// إنشاء مسودة الفاتورة الوحيدة للخط بعد اعتماد المهندس للأطوال فنياً.
// تُستدعى آلياً عند موافقة المهندس — ولا تُنشأ أبداً بغير ذلك.
export async function createDraftInvoiceForLine(
  driveLineId: string,
  actor: { id: string; name: string },
  opts?: { isSettlement?: boolean; reason?: string; settlementLength?: number }
): Promise<CreateDraftResult> {
  await ensureContractorDuesSupport()

  var line = await db.driveLine.findUnique({
    where: { id: driveLineId },
    include: { project: { select: { name: true, code: true } } },
  })
  if (!line) return { ok: false, status: 404, error: 'not_found', message: 'خط الحفر غير موجود' }
  if (!(Number(line.pricePerMeter) > 0) || !line.contractorName || !String(line.contractorName).trim()) {
    return { ok: false, status: 400, error: 'no_agreement', message: 'عقد المقاول غير مكتمل لهذا الخط — أدخل اسم المقاول وسعر المتر أولاً' }
  }

  // منع التكرار: لا فاتورة نشطة ثانية لنفس الخط — التسوية المالية المستقلة استثناء مصرّح به فقط
  var activeInvoice = await db.contractorInvoice.findFirst({
    where: { driveLineId: driveLineId, status: { in: INVOICE_ACTIVE_STATUSES } },
    select: { id: true, invoiceNo: true, status: true },
  })
  var isSettlement = opts?.isSettlement === true
  if (activeInvoice && !isSettlement) {
    return { ok: false, status: 409, error: 'duplicate_invoice', message: 'يوجد فاتورة نشطة بالفعل لهذا الخط (' + activeInvoice.invoiceNo + ') — لا يجوز إصدار فاتورة ثانية لنفس الأطوال، والتسوية الجديدة تحتاج إجراء تسوية مالية مصرّحاً به', invoice: activeInvoice }
  }

  // الحفر الفعلي من التقارير المعتمدة — إعادة حساب كاملة من المصدر
  var agg = await db.dailyReport.aggregate({
    where: { driveLineId: driveLineId, status: 'approved' },
    _sum: { dailyMeters: true, pipeJackedMeters: true },
  })
  var excavated = Math.max(0, Number(agg._sum.dailyMeters) || 0)

  // سقف الطول: المخطط أو آخر تعديل معتمد
  var lastExt = await db.contractorLineChange.findFirst({
    where: { driveLineId: driveLineId, changeType: 'planned_length' },
    orderBy: { createdAt: 'desc' },
  })
  var approvedPlanned = lastExt && Number(lastExt.newValue) > 0 ? Number(lastExt.newValue) : (Number(line.totalLength) || 0)
  var countedLength = Math.min(excavated, approvedPlanned)

  // ما سبق اعتماده لنفس الخط — يُخصم إجبارياً لمنع الازدواجية
  var settledOldAmount = Number(line.settledOldAmount) || 0
  var priorInvoices = await db.contractorInvoice.findMany({
    where: { driveLineId: driveLineId, status: { in: INVOICE_SETTLED_STATUSES } },
    select: { netAmount: true, approvedLength: true },
  })
  var approvedNewAmount = 0
  var newInvoicedLength = 0
  for (var inv of priorInvoices) {
    approvedNewAmount += Number(inv.netAmount) || 0
    newInvoicedLength += Number(inv.approvedLength) || 0
  }
  var previouslyApproved = round3(settledOldAmount + approvedNewAmount)
  var price = Number(line.pricePerMeter) || 0

  // طول هذه الفاتورة = الحفر المعتمد − ما سبق فوترته (أو الطول المطلوب في التسوية)
  var thisLength = isSettlement
    ? Math.max(0.001, Number((opts as any).settlementLength) || 0)
    : round3(Math.max(0, countedLength - (Number(line.settledOldLength) || 0) - newInvoicedLength))
  var totalAmount = round3((isSettlement ? thisLength : countedLength) * price)
  var netAmount = isSettlement ? round3(thisLength * price) : round3(totalAmount - previouslyApproved)

  if (netAmount <= 0) {
    return { ok: false, status: 400, error: 'no_new_dues', message: 'لا يوجد مستحق جديد لهذا الخط — كل الأطوال المسجلة سبق اعتمادها أو تسويتها مالياً' }
  }

  var invoiceNo = await nextInvoiceNo(line.lineNumber)
  var created = await db.contractorInvoice.create({
    data: {
      invoiceNo: invoiceNo,
      driveLineId: line.id,
      contractorName: String(line.contractorName).trim(),
      projectName: line.project ? line.project.name : '',
      lineNumber: line.lineNumber,
      diameter: line.diameter || '',
      approvedLength: round3(thisLength),
      pricePerMeter: price,
      totalAmount: round3(isSettlement ? netAmount : totalAmount),
      previouslyApprovedAmount: previouslyApproved,
      netAmount: netAmount,
      status: 'pending_financial',
      isSettlement: isSettlement,
      settlementReason: isSettlement ? String(opts?.reason || '').trim() : null,
      createdById: actor.id,
      createdByName: actor.name,
    },
  })

  await db.auditLog.create({
    data: {
      userId: actor.id,
      projectId: line.projectId,
      action: 'create',
      entity: 'contractor_invoice',
      entityId: created.id,
      details: 'إنشاء مسودة فاتورة مقاول ' + invoiceNo + ' — الخط ' + line.lineNumber + ' — الطول المعتمد ' + thisLength + ' م × ' + price + ' ر.ع = صافي ' + netAmount + ' ر.ع (المعتمد سابقاً المخصوم: ' + previouslyApproved + ' ر.ع)' + (isSettlement ? ' — تسوية مالية مصرح بها: ' + String(opts?.reason || '') : ''),
    },
  })

  // إشعار أصحاب الاعتماد المالي (مودة) — الفاتورة بانتظار المراجعة المالية
  try {
    await notifyUsers({
      type: 'contractor_invoice_financial_review',
      title: isSettlement ? 'فاتورة تسوية مالية لمقاول حفر — بانتظار الاعتماد المالي' : 'فاتورة مقاول بانتظار الاعتماد المالي',
      message: 'الفاتورة ' + invoiceNo + ' — الخط ' + line.lineNumber + ' (' + (line.project ? line.project.name : '') + ') — المقاول: ' + String(line.contractorName).trim() + ' — الطول المعتمد: ' + thisLength + ' م — السعر: ' + price + ' ر.ع/م — صافي المستحق: ' + netAmount + ' ر.ع — بانتظار مراجعتكم المالية (سعر المتر، الإجمالي، عدم التكرار، المعتمد سابقاً).',
      severity: 'info',
      entityType: 'contractor_invoice',
      entityId: created.id,
      link: 'costs',
      permissions: ['contractor_finance_review', 'costs'],
      includeSystemAdmin: true,
    })
  } catch (nE) {
    console.error('v123: notify financial reviewers failed (non-fatal):', nE)
  }

  return { ok: true, invoice: created }
}
