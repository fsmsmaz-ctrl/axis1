// ============================================================
// v123 — فواتير المقاول (الآلية القديمة) — وحدة متقاعدة Retired
// AXIS Pipe Jacking Management System
// ============================================================
// بناءً على مواصفة إعادة برمجة مستحقات مقاولي الحفر النفقي (v123):
//   • آلية «فاتورة لكل 10 أمتار» (v114/v116) أُلغيت بالكامل.
//   • لا توليد آلي، لا مقترحات، ولا اعتماد مقترحات بعد اليوم.
//   • المستحقات التراكمية تُحتسب تلقائياً لكل خط من أطوال الحفر
//     الفعلية في المسار الجديد: src/lib/contractor-dues.ts
//   • فاتورة واحدة لكل خط تُنشأ آلياً بعد الاعتماد الفني للمهندس،
//     ثم تمر بالاعتماد المالي فالاعتماد النهائي لمالك الشركة.
//   • الفواتير القديمة المعتمدة والمدفوعة تبقى سجلات مالية محفوظة
//     في جدول التكاليف كما هي — لا تُحذف ولا تُعدل، وأطوالها تُرحَّل
//     إلى الخط عبر مسار الترحيل /api/admin/contractor-migration-v123
//     لمنع احتسابها مرة أخرى.
// التواقيع أدناه محفوظة كما هي حتى تبقى كل المستوردات القائمة
// تعمل بلا أي تعديل — الإرجاعات فقط صارت «متقاعدة».
// ============================================================

import { db } from '@/lib/db'

export interface ContractorMaintenanceResult {
  ran: boolean
  deleted: number
  skipped?: 'throttled'
  error?: string
}

export interface PendingContractorInvoice {
  token: string
  projectId: string | null
  projectName: string
  lineId: string
  lineNumber: string
  segmentLabel: string
  meters: number
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

export interface ApproveContractorInvoiceResult {
  ok: boolean
  duplicate?: boolean
  expired?: boolean
  costId?: string
  message?: string
}

var RETIRED_MESSAGE = 'آلية فواتير الـ 10 أمتار أُلغيت في التحديث 123 — المستحقات التراكمية تُحتسب الآن تلقائياً لكل خط من أطوال الحفر الفعلية في التقارير المعتمدة، وفاتورة واحدة لكل خط تُنشأ آلياً بعد اعتماد المهندس للأطوال ثم تمر بالاعتماد المالي فالاعتماد النهائي لمالك الشركة. الفواتير القديمة المعتمدة والمدفوعة تبقى سجلات مالية محفوظة.'

/**
 * v123 (متقاعدة): كان التنظيف الرجعي يحذف فواتير v114 الآلية.
 * اليوم لا يولّد ولا يحذف أي شيء — إرجاع فوري بلا أي عملية قاعدة.
 */
export async function maintainContractorInvoices(opts?: { force?: boolean }): Promise<ContractorMaintenanceResult> {
  return { ran: true, deleted: 0 }
}

/**
 * v123 (متقاعدة): كانت تحسب مقترحات الفواتير بانتظار الموافقة.
 * اليوم لا مقترحات إطلاقاً — المستحقات التراكمية تظهر مباشرة على
 * كل خط في قسم التكاليف عبر GET /api/contractor-dues.
 */
export async function listPendingContractorInvoices(opts?: { force?: boolean }): Promise<ContractorPendingResult> {
  return { ran: true, pending: [], count: 0, truncated: false, skippedNoPrice: 0, linesChecked: 0 }
}

/**
 * v123 (متقاعدة): كان يعتمد مقترح فاتورة بعد إدخال السعر يدوياً.
 * اليوم يُرفض كل استدعاء برسالة واضحة تشير إلى النظام الجديد.
 */
export async function approveContractorInvoice(opts: { token: string; amount: number; userId: string }): Promise<ApproveContractorInvoiceResult> {
  return { ok: false, message: RETIRED_MESSAGE }
}

// فحص سريع للاتصال بقاعدة البيانات — يبقي استيراد db مفيداً ويكشف تعطل الاتصال مبكراً
export async function contractorInvoicesHealthCheck(): Promise<boolean> {
  try {
    await db.cost.findFirst({ select: { id: true } })
    return true
  } catch {
    return false
  }
}
