// Shared report label maps & helpers — used by the reports page (screen preview)
// and the printable report document (PDF export) so both always stay in sync.

import {
  FileText, FileSpreadsheet, FileBarChart, Calendar, DollarSign,
  Shield, Users, Wrench, CheckCircle2, TrendingUp,
} from 'lucide-react'

export interface ReportType {
  id: string
  labelAr: string
  labelEn: string
  icon: any
  color: string
  description: string
}

export const reportTypes: ReportType[] = [
  { id: 'daily_site', labelAr: 'التقرير اليومي للموقع', labelEn: 'Daily Site Report', icon: FileText, color: 'text-blue-600', description: 'تقرير شامل لكل ما يحدث في الموقع يومياً' },
  { id: 'production', labelAr: 'تقرير الإنتاج اليومي', labelEn: 'Production Report', icon: TrendingUp, color: 'text-emerald-600', description: 'تفاصيل الإنتاج اليومي والأمتار المنجزة' },
  { id: 'safety', labelAr: 'تقرير السلامة اليومي', labelEn: 'Safety Report', icon: Shield, color: 'text-orange-600', description: 'فحوصات السلامة والمخالفات' },
  { id: 'attendance', labelAr: 'تقرير الحضور', labelEn: 'Attendance Report', icon: Users, color: 'text-purple-600', description: 'حضور العمال والغياب' },
  { id: 'revenue', labelAr: 'تقرير الإيرادات', labelEn: 'Revenue Report', icon: DollarSign, color: 'text-emerald-600', description: 'الإيرادات اليومية والشهرية' },
  { id: 'costs', labelAr: 'تقرير التكاليف', labelEn: 'Cost Report', icon: DollarSign, color: 'text-red-600', description: 'التكاليف حسب الفئة' },
  { id: 'profit', labelAr: 'تقرير صافي الربح', labelEn: 'Profit Report', icon: DollarSign, color: 'text-blue-600', description: 'صافي الربح وهامش الربحية' },
  { id: 'equipment', labelAr: 'تقرير المعدات', labelEn: 'Equipment Report', icon: Wrench, color: 'text-cyan-600', description: 'حالة المعدات والصيانة' },
  { id: 'weekly', labelAr: 'تقرير الإنجاز الأسبوعي', labelEn: 'Weekly Progress', icon: Calendar, color: 'text-indigo-600', description: 'ملخص أسبوعي لجميع الأعمال' },
  { id: 'monthly', labelAr: 'تقرير شهري للإدارة', labelEn: 'Monthly Management', icon: FileBarChart, color: 'text-purple-600', description: 'تقرير شهري للإدارة العليا' },
  { id: 'handover', labelAr: 'تقرير تسليم الأعمال', labelEn: 'Handover Report', icon: CheckCircle2, color: 'text-emerald-600', description: 'تقارير التشطيب والتسليم' },
]

export const reportStatusLabels: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  submitted: { ar: 'مرسل', en: 'Submitted' },
  pending_approval: { ar: 'بانتظار الاعتماد', en: 'Pending Approval' },
  approved: { ar: 'معتمد', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
}

export const incidentLabels: Record<string, { ar: string; en: string }> = {
  none: { ar: 'لا يوجد', en: 'None' },
  near_miss: { ar: 'شبه حادث', en: 'Near Miss' },
  incident: { ar: 'حادث', en: 'Incident' },
  accident: { ar: 'حادث مع إصابة', en: 'Accident' },
}

export const handoverStatusLabels: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار القبول', en: 'Pending' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  needs_revision: { ar: 'يحتاج تعديل', en: 'Needs Revision' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
}

export const equipmentStatusLabels: Record<string, { ar: string; en: string }> = {
  operational: { ar: 'تعمل', en: 'Operational' },
  maintenance_needed: { ar: 'تحتاج صيانة', en: 'Maintenance Needed' },
  stopped: { ar: 'متوقفة', en: 'Stopped' },
}

export const costCategoryLabels: Record<string, { ar: string; en: string }> = {
  labor: { ar: 'أجور العمال', en: 'Labor' },
  housing: { ar: 'سكن', en: 'Housing' },
  transport: { ar: 'نقل', en: 'Transport' },
  fuel: { ar: 'ديزل', en: 'Fuel' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  parts: { ar: 'قطع غيار', en: 'Parts' },
  oil: { ar: 'زيوت', en: 'Oil' },
  safety: { ar: 'سلامة', en: 'Safety' },
  rental: { ar: 'إيجارات', en: 'Rental' },
  other: { ar: 'أخرى', en: 'Other' },
}

export function localized(map: Record<string, { ar: string; en: string }>, key: any, isRtl: boolean): string {
  const item = key ? map[String(key)] : undefined
  if (!item) return key ? String(key) : '-'
  return isRtl ? item.ar : item.en
}

export function fmtNum(n: any): string {
  const v = Number(n)
  return isNaN(v) ? '0' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

