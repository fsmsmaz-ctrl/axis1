// ============================================================
// خدمة التنبيهات — AXIS Pipe Jacking Management System
// ============================================================
// توجيه التنبيهات لأشخاص محددين بناءً على الصلاحيات:
//  - permissions: مفاتيح صلاحيات (أي واحدة تكفي لاستلام التنبيه)
//    تُقيَّم عبر hasPermission الذي يحترم تجاوزات الصلاحيات
//    المخصصة لكل مستخدم (user.permissions) وأدوار المستخدمين.
//  - roles: أدوار تستلم التنبيه دائماً.
//  - كل مستخدم يحصل على صف تنبيه خاص به (userId) حتى يتمكن
//    من تعليمه كمقروء بشكل مستقل عن بقية المستلمين.
//  - منع التكرار: لا يُنشأ تنبيه جديد لنفس المستخدم إذا وُجد
//    تنبيه مطابق (نفس النوع + الكيان) غير مقروء ضمن مهلة dedupeHours.
//  - آمنة الاستخدام: أي خطأ داخلي يُسجَّل ولا يُفشل العملية الرئيسية.
// ============================================================

import { db } from './db'
import { hasPermission } from './auth'

export type NotifySeverity = 'info' | 'warning' | 'critical'

export interface NotifyOptions {
  type: string
  title: string
  message: string
  severity?: NotifySeverity
  projectId?: string | null
  /** صفحة النظام التي يفتحها النقر على التنبيه (PageId) */
  link?: string | null
  /** نوع الكيان المرتبط: daily_report, drive_line, finishing... */
  entityType?: string | null
  /** معرف الكيان المرتبط — أساس منع التكرار */
  entityId?: string | null
  /** مفاتيح الصلاحيات — يكفي تحقق واحدة لاستلام التنبيه */
  permissions: string[]
  /** أدوار تستلم التنبيه دائماً (اختياري) */
  roles?: string[]
  /** مستخدمون يُستثنون من الاستلام (عادةً صاحب الفعل نفسه) */
  excludeUserIds?: string[]
  /** إدخال مدير النظام (admin@axis.om) ضمن المستلمين قسراً */
  includeSystemAdmin?: boolean
  /** مهلة منع التكرار بالساعات (افتراضي 12) */
  dedupeHours?: number
}

export const SYSTEM_ADMIN_EMAIL = 'admin@axis.om'

/**
 * جلب معرفات المستخدمين المستلمين بناءً على الصلاحيات والأدوار.
 * تُقيَّم صلاحية كل مستخدم عبر hasPermission لتحترم:
 *  1) التجاوزات المخصصة المخزنة في user.permissions
 *  2) صلاحيات الدور الافتراضية (ROLE_PERMISSIONS)
 */
export async function resolveRecipientIds(
  permissions: string[],
  roles: string[] = [],
  excludeUserIds: string[] = [],
  includeSystemAdmin: boolean = false
): Promise<string[]> {
  try {
    const users = await db.user.findMany({
      where: { active: true },
      select: { id: true, role: true, email: true, permissions: true },
    })

    const exclude = new Set(excludeUserIds.filter(Boolean))
    const recipients: string[] = []

    for (const u of users) {
      if (exclude.has(u.id)) continue

      // تقييم الصلاحيات المخصصة للمستخدم (تجاوزات لكل مستخدم)
      const userPerms = u.permissions && typeof u.permissions === 'object' && !Array.isArray(u.permissions)
        ? u.permissions as Record<string, boolean>
        : null

      const allowed =
        roles.includes(u.role) ||
        permissions.some((p) => hasPermission(u.role, p, userPerms)) ||
        (includeSystemAdmin && (u.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL)

      if (allowed) recipients.push(u.id)
    }

    return recipients
  } catch (error) {
    console.error('[notify] resolveRecipientIds failed:', error)
    return []
  }
}

/**
 * إنشاء تنبيهات موجهة لكل مستلم (صف مستقل لكل مستخدم).
 * @returns عدد التنبيهات التي تم إنشاؤها فعلياً
 */
export async function notifyUsers(opts: NotifyOptions): Promise<number> {
  try {
    const recipientIds = await resolveRecipientIds(
      opts.permissions,
      opts.roles || [],
      opts.excludeUserIds || [],
      opts.includeSystemAdmin || false
    )
    if (recipientIds.length === 0) return 0

    // ── منع التكرار: تجاهل المستلمين الذين لديهم تنبيه مطابق حديث ──
    let finalIds = recipientIds
    const dedupeHours = opts.dedupeHours ?? 12
    if (opts.entityId) {
      const cutoff = new Date(Date.now() - dedupeHours * 60 * 60 * 1000)
      const recent = await db.notification.findMany({
        where: {
          type: opts.type,
          entityId: opts.entityId,
          userId: { in: recipientIds },
          createdAt: { gte: cutoff },
        },
        select: { userId: true },
      })
      const already = new Set(recent.map((r) => r.userId))
      finalIds = recipientIds.filter((id) => !already.has(id))
    }

    if (finalIds.length === 0) return 0

    const severity: NotifySeverity = opts.severity || 'info'
    const result = await db.notification.createMany({
      data: finalIds.map((userId) => ({
        userId,
        projectId: opts.projectId || null,
        type: opts.type,
        title: opts.title,
        message: opts.message,
        severity,
        link: opts.link || null,
        entityType: opts.entityType || null,
        entityId: opts.entityId || null,
        read: false,
      })),
    })

    return result.count
  } catch (error) {
    // التنبيه غير حرج — لا يُفشل العملية الرئيسية أبداً
    console.error('[notify] notifyUsers failed:', error)
    return 0
  }
}

/**
 * إنشاء تنبيه عام (broadcast) يظهر لكل من لديه الصلاحية عند العرض.
 * يُستخدم للإشعارات المعلوماتية العامة فقط — التنبيهات الإجرائية
 * (اعتماد/تأخير/اكتمال) تُرسل كصفوف مستقلة لكل مستلم عبر notifyUsers.
 */
export async function notifyBroadcast(opts: Omit<NotifyOptions, 'permissions' | 'roles' | 'excludeUserIds' | 'includeSystemAdmin'>): Promise<boolean> {
  try {
    await db.notification.create({
      data: {
        userId: null,
        projectId: opts.projectId || null,
        type: opts.type,
        title: opts.title,
        message: opts.message,
        severity: opts.severity || 'info',
        link: opts.link || null,
        entityType: opts.entityType || null,
        entityId: opts.entityId || null,
      },
    })
    return true
  } catch (error) {
    console.error('[notify] notifyBroadcast failed:', error)
    return false
  }
}

