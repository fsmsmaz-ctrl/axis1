// ============================================================
// الرقابة العملية — ثوابت وأدوات مشتركة (v17)
// Shared constants & helpers for the Operational Control section.
// آمنة للاستخدام في العميل والخادم معاً (client-safe).
// ============================================================

import { SYSTEM_ADMIN_EMAIL } from './auth'

/**
 * أنواع سجلات "الرقابة العملية" — محذوفة من قسم "التنبيهات" لجميع
 * المستخدمين دون استثناء (v19)، وموطنها الحصري قسم "الرقابة العملية"
 * (api/oversight) المتاح للإدارة العليا ومديري المشاريع ومدير النظام.
 *
 * تشمل هذه القائمة:
 *  1) إشعارات عمليات البيانات (إضافة / تعديل / حذف):
 *     project_created, drive_line_completed, cost_overrun, report_delay (حذف تقرير)
 *  2) التحذيرات الرقابية الموجهة للإدارة:
 *     report_pending_approval, safety_missing, finishing_incomplete,
 *     finishing_pending_approval, performance_ready
 *  3) متابعة المهام الإدارية (النسخ الموجهة للإدارة):
 *     task_overdue, task_due_soon, task_review_pending, task_waiting, task_ready_review
 *  4) أنواع رقابية قديمة (سجلات سابقة في قاعدة البيانات تُنقل هي الأخرى):
 *     safety_alert, work_stopped, low_production, equipment_breakdown,
 *     mass_absence, deadline_near
 *
 * التنبيهات الشخصية تبقى في قسم التنبيهات لجميع المستخدمين دون استثناء:
 * task_assigned, task_returned, task_approved, task_cancelled,
 * task_due_changed, report_approved, finishing_approved, finishing_rejected
 * + تذكيرات المكلَّف الشخصية task_due_reminder / task_overdue_reminder
 * (v19: فُصلت عن task_due_soon/task_overdue الرقابيتين حتى لا يفقد الموظف
 * تذكير مهامه الخاصة بعد نقل النسخ الرقابية إلى قسم الرقابة).
 */
export const OVERSIGHT_NOTIFICATION_TYPES = [
  'project_created',
  'report_pending_approval',
  'report_delay',
  'safety_missing',
  'finishing_incomplete',
  'finishing_pending_approval',
  'drive_line_completed',
  'performance_ready',
  'cost_overrun',
  'task_review_pending',
  'task_waiting',
  'task_ready_review',
  'task_overdue',
  'task_due_soon',
  // v49: تغييرات الملف الشخصي والمشتريات — موطنها الحصري قسم الرقابة العملية
  'profile_updated',
  'password_changed',
  'purchase_log',
  // أنواع رقابية قديمة — سجلاتها التاريخية تظهر في قسم الرقابة فقط (v19)
  'safety_alert',
  'work_stopped',
  'low_production',
  'equipment_breakdown',
  'mass_absence',
  'deadline_near',
] as const

/**
 * هل يمكن لهذا المستخدم رؤية قسم الرقابة العملية؟
 * الإدارة العليا + مديرو المشاريع + مدير النظام فقط —
 * نفس بوابة سجل المراقبة (api/audit-logs).
 */
export function isOversightViewer(
  user: { role?: string; email?: string; isSystemAdmin?: boolean } | null | undefined
): boolean {
  if (!user) return false
  // مدير النظام بعلم قاعدة البيانات — يرى الرقابة دائماً
  if (user.isSystemAdmin === true) return true
  const email = (user.email || '').toLowerCase().trim()
  if (email === SYSTEM_ADMIN_EMAIL) return true
  return user.role === 'top_management' || user.role === 'project_manager'
}

