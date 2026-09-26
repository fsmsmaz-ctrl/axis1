// ============================================================
// v49: ربط تغييرات الملف الشخصي بقسم «الرقابة العملية»
// 1) logProfileAudit — صف في سجل عمليات البيانات (AuditLog) يظهر في
//    «الرقابة العملية ← سجل العمليات» مع الفلاتر والتفاصيل.
// 2) logOversightEvent — تنبيه رقابي عام (userId: null) بأنواع حصرية
//    (profile_updated / password_changed / purchase_log) تظهر في
//    «الرقابة العملية» فقط ولا تُعرض في التنبيهات الشخصية لأحد —
//    لأن الأنواع الرقابية محجوبة عن قسم التنبيهات (نمط v19).
// كلاهما best-effort: أي خطأ يُسجَّل ولا يُفشل العملية الأصلية.
// ============================================================

import { db } from './db'

// كتابة صف في سجل عمليات البيانات (AuditLog)
export async function logProfileAudit(entry: {
  actorId: string
  action: string   // update, create, delete, submit, approve, reject
  entity: string   // user, purchase
  entityId: string
  details: string
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        details: entry.details,
      },
    })
  } catch (e) {
    console.warn('v49 profile audit log skipped:', e)
  }
}

// تنبيه رقابي عام (userId: null) — يظهر في قسم الرقابة العملية فقط
export async function logOversightEvent(ev: {
  type: string
  title: string
  message: string
  severity?: string
  link?: string | null
  entityType?: string | null
  entityId?: string | null
}): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId: null,
        type: ev.type,
        title: ev.title,
        message: ev.message,
        severity: ev.severity || 'info',
        link: ev.link || null,
        entityType: ev.entityType || null,
        entityId: ev.entityId || null,
      },
    })
  } catch (e) {
    console.warn('v49 oversight event skipped:', e)
  }
}
