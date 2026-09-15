// ============================================================
// الرقابة العملية — ثوابت وأدوات مشتركة (v17)
// Shared constants & helpers for the Operational Control section.
// آمنة للاستخدام في العميل والخادم معاً (client-safe).
// ============================================================

import { SYSTEM_ADMIN_EMAIL } from './auth'

/**
 * أنواع التنبيهات التي تُنقل من قسم "التنبيهات" إلى قسم "الرقابة العملية"
 * لمشاهدي الإدارة (الإدارة العليا / مديرو المشاريع / مدير النظام) فقط —
 * الموظفون الآخرون يواصلون رؤية تنبيهاتهم الشخصية في قسم التنبيهات كالمعتاد.
 *
 * تشمل هذه القائمة:
 *  1) إشعارات عمليات البيانات (إضافة / تعديل / حذف):
 *     project_created, drive_line_completed, cost_overrun, report_delay (حذف تقرير)
 *  2) التحذيرات الرقابية الموجهة للإدارة:
 *     report_pending_approval, safety_missing, finishing_incomplete,
 *     finishing_pending_approval, performance_ready
 *  3) متابعة المهام:
 *     task_overdue, task_due_soon, task_review_pending, task_waiting, task_ready_review
 *
 * التنبيهات الشخصية (task_assigned, task_returned, task_approved, task_cancelled,
 * task_due_changed, report_approved, finishing_approved, finishing_rejected)
 * تبقى في قسم التنبيهات لجميع المستخدمين دون استثناء.
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

