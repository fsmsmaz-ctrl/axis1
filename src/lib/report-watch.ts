// ============================================================
// مراقب التقارير — فحص دوري للتأخيرات وإصدار التنبيهات
// ============================================================
// يرصد الحالات التالية ويُصدر تنبيهات موجهة لأصحاب الصلاحيات:
//  1) تقارير يومية لم تُسلَّم (مسودة متأخرة عن 24 ساعة)
//  2) تقارير مسلَّمة بانتظار الاعتماد (متأخرة عن 24 ساعة)
//  3) تقارير سلامة ناقصة لأيام عمل فعلية (حفر بدون فحص سلامة)
//  4) تشطيبات غير مكتملة (بنود ناقصة أو لم يُقبل التسليم)
//  5) جاهزية تقييم الأداء (بداية الشهر والشهر الماضي به تقارير معتمدة)
//
// يُشغَّل الفحص مرة واحدة كحد أقصى كل 10 دقائق (throttle) مع قفل
// لمنع التزامن، ومنع تكرار التنبيه الواحد عبر entityId في notifyUsers.
// ============================================================

import { db } from './db'
import { notifyUsers } from './notify'

const SCAN_INTERVAL_MS = 10 * 60 * 1000 // 10 دقائق بين كل فحص والآخر

let lastScanAt: number = 0
let scanInFlight: Promise<{ created: number }> | null = null

function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** تنفيذ الفحص الكامل الآن — يُرجع عدد التنبيهات المُنشأة */
export async function runScanNow(): Promise<{ created: number }> {
  let created = 0
  const now = new Date()
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const threeDaysAgo = startOfTodayUTC()
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3)

  // ─────────────────────────────────────────────────────────
  // 1) تقارير يومية لم تُسلَّم (مسودة متأخرة) — لمستخدمي التسليم
  // ─────────────────────────────────────────────────────────
  try {
    const staleDrafts = await db.dailyReport.findMany({
      where: { status: 'draft', createdAt: { lt: cutoff24h }, reportDate: { gte: threeDaysAgo } },
      select: {
        id: true, reportDate: true, projectId: true, createdById: true,
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
    })

    for (const r of staleDrafts) {
      const dateStr = fmtDate(new Date(r.reportDate))
      const linePart = r.driveLine?.lineNumber ? ' — خط ' + r.driveLine.lineNumber : ''
      const count = await notifyUsers({
        type: 'report_delay',
        title: 'تأخير في تسليم تقرير يومي',
        message: 'تقرير يومي بتاريخ ' + dateStr + ' لم يتم تسليمه بعد' + linePart + ' — مشروع ' + (r.project?.name || r.project?.code || '') + '. يرجى إكمال بياناته وتسليمه للاعتماد.',
        severity: 'warning',
        projectId: r.projectId,
        link: 'dailyReports',
        entityType: 'daily_report',
        entityId: r.id,
        // مَن يسلّم: المشرف (foreman) ومدير النظام + أصحاب صلاحية التقارير اليومية
        permissions: ['daily_reports'],
        roles: ['foreman', 'project_manager'],
        excludeUserIds: r.createdById ? [r.createdById] : [],
        dedupeHours: 20,
      })
      created += count
    }
  } catch (e) {
    console.error('[report-watch] stale drafts scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 2) تقارير مسلَّمة بانتظار الاعتماد — لأصحاب صلاحية الاعتماد
  // ─────────────────────────────────────────────────────────
  try {
    const pendingApprovals = await db.dailyReport.findMany({
      where: { status: 'submitted', updatedAt: { lt: cutoff24h } },
      select: {
        id: true, reportDate: true, projectId: true,
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    })

    for (const r of pendingApprovals) {
      const dateStr = fmtDate(new Date(r.reportDate))
      const linePart = r.driveLine?.lineNumber ? ' — خط ' + r.driveLine.lineNumber : ''
      const count = await notifyUsers({
        type: 'report_delay',
        title: 'تقرير يومي بانتظار الاعتماد منذ أكثر من 24 ساعة',
        message: 'تقرير يومي بتاريخ ' + dateStr + ' مُسلَّم ولم يُعتمد بعد' + linePart + ' — مشروع ' + (r.project?.name || r.project?.code || '') + '. يتطلب إجراء الاعتماد.',
        severity: 'warning',
        projectId: r.projectId,
        link: 'dailyReports',
        entityType: 'daily_report',
        entityId: r.id + ':approval',
        // الاعتماد متاح لمدير النظام والإدارة العليا فقط (نفس منطق مسار الاعتماد)
        permissions: [],
        roles: ['top_management'],
        includeSystemAdmin: true,
        dedupeHours: 20,
      })
      created += count
    }
  } catch (e) {
    console.error('[report-watch] pending approvals scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 3) تقارير سلامة ناقصة لأيام العمل الفعلية — لأصحاب صلاحية السلامة
  // ─────────────────────────────────────────────────────────
  try {
    const workReports = await db.dailyReport.findMany({
      where: {
        reportDate: { gte: threeDaysAgo, lt: startOfTodayUTC() },
        // يوم عمل فعلي: حفر مسجل أو ساعات تشغيل
        OR: [{ dailyMeters: { gt: 0 } }, { operatingHours: { gt: 0 } }],
      },
      select: {
        id: true, reportDate: true, projectId: true,
        project: { select: { name: true, code: true } },
        driveLine: { select: { lineNumber: true } },
      },
      orderBy: { reportDate: 'desc' },
      take: 30,
    })

    if (workReports.length > 0) {
      const ids = workReports.map((r) => r.id)
      const signedSafety = await db.safetyReport.findMany({
        where: { dailyReportId: { in: ids } },
        select: { dailyReportId: true },
      })
      const signedSet = new Set(signedSafety.map((s) => s.dailyReportId))
      const missingSafety = workReports.filter((r) => !signedSet.has(r.id))

      for (const r of missingSafety) {
        const dateStr = fmtDate(new Date(r.reportDate))
        const linePart = r.driveLine?.lineNumber ? ' — خط ' + r.driveLine.lineNumber : ''
        const count = await notifyUsers({
          type: 'safety_missing',
          title: 'تقرير سلامة غير مسجل ليوم عمل',
          message: 'تم تسجيل عمل حفر بتاريخ ' + dateStr + linePart + ' — مشروع ' + (r.project?.name || r.project?.code || '') + ' دون تقرير سلامة مطابق. يرجى استكمال تقرير السلامة.',
          severity: 'critical',
          projectId: r.projectId,
          link: 'safety',
          entityType: 'daily_report',
          entityId: r.id + ':safety',
          permissions: ['safety'],
          roles: ['hse_officer'],
          dedupeHours: 20,
        })
        created += count
      }
    }
  } catch (e) {
    console.error('[report-watch] missing safety scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 4) تشطيبات غير مكتملة — لأصحاب صلاحية التشطيبات
  // ─────────────────────────────────────────────────────────
  try {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const openFinishings = await db.finishing.findMany({
      where: {
        date: { gte: monthAgo, lt: twoDaysAgo },
        handoverStatus: { in: ['pending', 'needs_revision'] },
      },
      select: {
        id: true, date: true, projectId: true, driveLineId: true, siteCleaned: true, wasteRemoved: true,
        shaftClosed: true, siteRestored: true, lineHandover: true, handoverStatus: true,
        project: { select: { name: true, code: true } },
      },
      orderBy: { date: 'asc' },
      take: 25,
    })

    // جلب أرقام خطوط الحفر المرتبطة (Finishing لا يحتوي علاقة مباشرة مع DriveLine)
    const lineIds = openFinishings.map((f) => f.driveLineId).filter((v): v is string => !!v)
    const lineMap: Record<string, string> = {}
    if (lineIds.length > 0) {
      const lines = await db.driveLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, lineNumber: true },
      })
      for (const l of lines) lineMap[l.id] = l.lineNumber
    }

    for (const f of openFinishings) {
      const missing: string[] = []
      if (!f.siteCleaned) missing.push('تنظيف الموقع')
      if (!f.wasteRemoved) missing.push('إزالة النفايات')
      if (!f.shaftClosed) missing.push('غلق البئر')
      if (!f.siteRestored) missing.push('إعادة الموقع')
      if (!f.lineHandover) missing.push('تسليم الخط')
      if (missing.length === 0) continue

      const dateStr = fmtDate(new Date(f.date))
      const linePart = f.driveLineId && lineMap[f.driveLineId] ? ' — خط ' + lineMap[f.driveLineId] : ''
      const count = await notifyUsers({
        type: 'finishing_incomplete',
        title: 'تشطيب غير مكتمل',
        message: 'تشطيب بتاريخ ' + dateStr + linePart + ' — مشروع ' + (f.project?.name || f.project?.code || '') + ' به بنود غير مكتملة: ' + missing.join('، ') + '.',
        severity: 'warning',
        projectId: f.projectId,
        link: 'finishings',
        entityType: 'finishing',
        entityId: f.id,
        permissions: ['finishings'],
        roles: ['project_manager'],
        dedupeHours: 48,
      })
      created += count
    }
  } catch (e) {
    console.error('[report-watch] incomplete finishings scan failed:', e)
  }

  // ─────────────────────────────────────────────────────────
  // 5) جاهزية تقييم الأداء (تلخيص الشهر الماضي) — لأصحاب صلاحية الأداء
  // ─────────────────────────────────────────────────────────
  try {
    const todayUTC = startOfTodayUTC()
    const dayOfMonth = todayUTC.getUTCDate()
    // أول 7 أيام من الشهر: ملخص الشهر الماضي جاهز للتوليد
    if (dayOfMonth <= 7) {
      const prevMonthEnd = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 0)) // آخر يوم من الشهر السابق
      const prevMonthStart = new Date(Date.UTC(prevMonthEnd.getUTCFullYear(), prevMonthEnd.getUTCMonth(), 1))
      const monthKey = 'perf-' + fmtDate(prevMonthStart).slice(0, 7)

      const approvedCount = await db.dailyReport.count({
        where: { status: 'approved', reportDate: { gte: prevMonthStart, lte: prevMonthEnd } },
      })

      if (approvedCount > 0) {
        const monthName = fmtDate(prevMonthStart).slice(0, 7)
        const count = await notifyUsers({
          type: 'performance_ready',
          title: 'جاهزية تقييم الأداء الشهري',
          message: 'تم اعتماد ' + approvedCount + ' تقريراً يومياً خلال شهر ' + monthName + ' — الملخص الشهري وتقييم الأداء جاهزان للمراجعة والتلخيص.',
          severity: 'info',
          link: 'performance',
          entityType: 'performance',
          entityId: monthKey,
          permissions: ['performance'],
          roles: ['top_management', 'project_manager'],
          dedupeHours: 24 * 20, // مرة واحدة شهرياً تقريباً
        })
        created += count
      }
    }
  } catch (e) {
    console.error('[report-watch] performance readiness scan failed:', e)
  }

  return { created }
}

/**
 * تشغيل الفحص مع throttle — يُنفَّذ مرة واحدة كحد أقصى كل 10 دقائق.
 * إذا كان هناك فحص جارٍ يُعاد نتيجته بدل تشغيل فحص ثانٍ.
 */
export async function runScanThrottled(force: boolean = false): Promise<{ created: number; skipped: boolean }> {
  const now = Date.now()
  if (!force && now - lastScanAt < SCAN_INTERVAL_MS) {
    return { created: 0, skipped: true }
  }
  if (scanInFlight) return { ...(await scanInFlight), skipped: true }

  lastScanAt = now
  scanInFlight = runScanNow()
  try {
    const result = await scanInFlight
    return { ...result, skipped: false }
  } finally {
    scanInFlight = null
  }
}

