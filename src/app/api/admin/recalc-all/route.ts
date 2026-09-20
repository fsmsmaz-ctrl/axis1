import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db, invalidateCachePrefix } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp } from '@/lib/api-helpers'

// Admin/Manager endpoint to recalculate ALL progress data.
// Call via: POST /api/admin/recalc-all
// This fixes:
// 1. Daily report dailyMeters for all reports
// 2. DriveLine completedLength and progress
// 3. Project progress
// 4. Invalidates the dashboard cache so the new numbers show up immediately.
// v29: التصحيح الرجعي الشامل لنقل التقارير — يعيد تثبيت قراءات كل خط زمنياً
// (سلسلة تراكمية متصلة لكل خط) ويصلح مشتقات كل تقرير نسبةً إلى خطه الحالي:
// totalMeters/remainingMeters/progressPercent + dailyMeters/dailyRevenue.

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    // SECURITY FIX: كان مدير المشروع مسموحاً — عملية عالمية تعيد كتابة المبالغ
    // المالية لكل التقارير (بما فيها المعتمدة) أصبحت للإدارة العليا ومدير النظام فقط
    var isSystemAdmin = (user.email || '').toLowerCase().trim() === 'admin@axis.om'
    if (user.role !== 'top_management' && !isSystemAdmin) {
      return NextResponse.json(
        { error: 'forbidden', message: 'إعادة الحساب الشاملة متاحة للإدارة العليا فقط' },
        { status: 403 }
      )
    }

    // SECURITY FIX: حد معدل — العملية ثقيلة على قاعدة البيانات وكانت قابلة
    // للاستدعاء المتكرر بلا قيود (إرهاق Postgres)
    var rl = checkRateLimit(req, { maxRequests: 3, windowSeconds: 300, keyPrefix: 'recalc' })
    if (rl.limited) {
      return NextResponse.json(
        { error: 'too_many_requests', message: 'طلبات كثيرة جداً — إعادة الحساب الشاملة مسموحة 3 مرات كل 5 دقائق' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const results = {
      projectsFixed: 0,
      driveLinesFixed: 0,
      reportsFixed: 0,
      reportsReanchored: 0,
      errors: [] as string[],
    }

    // Step 1: Get ALL projects (pricePerMeter is fallback only after v13)
    const projects = await db.project.findMany({
      select: { id: true, totalLength: true, pricePerMeter: true },
    })

    // v13: Build map of drive-line prices — each report is priced by ITS line
    const allLines = await db.driveLine.findMany({ select: { id: true, pricePerMeter: true } })
    const linePriceMap: Record<string, number | null> = {}
    for (const l of allLines) linePriceMap[l.id] = l.pricePerMeter

    // Process projects sequentially to avoid connection pool exhaustion.
    for (const project of projects) {
      try {
        // Step 2: Get all daily reports for this project
        const reports = await db.dailyReport.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            startReading: true,
            endReading: true,
            dailyMeters: true,
            dailyRevenue: true,
            driveLineId: true,
            status: true,
            totalMeters: true,
            remainingMeters: true,
            progressPercent: true,
            reportDate: true,
            createdAt: true,
          },
        })

        // Step 3: Fix each report's dailyMeters, dailyRevenue AND assignment-derived fields.
        // v13: dailyRevenue = dailyMeters × (سعر خط الحفر || سعر المشروع احتياطياً)
        // v29: تُجلب خطوط المشروع أولاً ثم تُعالج تقارير كل خط كسلسلة تراكمية
        // زمنية متصلة — هذا يصلح رجعياً التقارير المنقولة سابقاً بين المشاريع/الخطوط:
        // نقطة ارتكاز كل تقرير = نهاية التقرير السابق زمنياً على نفس الخط،
        // والأمتار اليومية الحقيقية (endReading - startReading) تُحفظ كما هي،
        // فتصبح MAX(endReading) = SUM(dailyMeters) لكل خط وتختفي التلوثات.
        const projectPrice = project.pricePerMeter || 0

        const driveLines = await db.driveLine.findMany({
          where: { projectId: project.id },
          select: { id: true, totalLength: true },
        })
        const lineLenMap: Record<string, number> = {}
        for (const dl of driveLines) lineLenMap[dl.id] = dl.totalLength || 0

        // v29: تجميع تقارير المشروع حسب الخط وترتيبها زمنياً لبناء السلسلة
        const reportsByLine: Record<string, any[]> = {}
        const noLineReports: any[] = []
        for (const r of reports) {
          if (r.driveLineId) {
            if (!reportsByLine[r.driveLineId]) reportsByLine[r.driveLineId] = []
            reportsByLine[r.driveLineId].push(r)
          } else {
            noLineReports.push(r)
          }
        }

        // القيم المصححة لكل تقرير: قراءات مُثبَّتة على السلسلة + المشتقات نسبةً للخط الحالي
        const corrections = new Map<string, any>()
        for (const lineIdStr of Object.keys(reportsByLine)) {
          const lineReports = reportsByLine[lineIdStr].slice().sort(function(a: any, b: any) {
            const da = new Date(a.reportDate).getTime()
            const dbb = new Date(b.reportDate).getTime()
            if (da !== dbb) return da - dbb
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          })
          let anchor = 0
          for (const r of lineReports) {
            const increment = Math.max(0, (r.endReading || 0) - (r.startReading || 0))
            if (increment <= 0) continue // تقارير بلا حفر (سلامة فقط) — لا تُثبَّت
            const corrStart = anchor
            const corrEnd = anchor + increment
            anchor = corrEnd
            corrections.set(r.id, { corrStart: corrStart, corrEnd: corrEnd, increment: increment })
          }
        }

        for (const r of reports) {
          const linePrice = r.driveLineId ? linePriceMap[r.driveLineId] : null
          const effectivePrice = linePrice != null ? linePrice : projectPrice

          // v29: القراءات المصححة من السلسلة الزمنية إن وجدت وإلا القراءات المخزنة
          const corr = corrections.get(r.id)
          const correctStartReading = corr ? corr.corrStart : (r.startReading || 0)
          const correctEndReading = corr ? corr.corrEnd : (r.endReading || 0)
          const correctDailyMeters = corr ? corr.increment : Math.max(0, (r.endReading || 0) - (r.startReading || 0))
          const correctDailyRevenue = correctDailyMeters * effectivePrice

          // v29: المشتقات نسبةً إلى الخط الحالي للتقرير (وليس الخط القديم)
          const lineLen = r.driveLineId ? (lineLenMap[r.driveLineId] || 0) : 0
          const correctTotalMeters = correctEndReading
          const correctRemainingMeters = Math.max(0, lineLen - correctEndReading)
          const correctProgressPercent = lineLen > 0 ? Math.min((correctEndReading / lineLen) * 100, 100) : 0

          const needsUpdate =
            Math.abs((r.dailyMeters || 0) - correctDailyMeters) > 0.001 ||
            r.dailyMeters === null ||
            Math.abs((r.dailyRevenue || 0) - correctDailyRevenue) > 0.001 ||
            Math.abs((r.startReading || 0) - correctStartReading) > 0.001 ||
            Math.abs((r.endReading || 0) - correctEndReading) > 0.001 ||
            Math.abs((r.totalMeters || 0) - correctTotalMeters) > 0.001 ||
            Math.abs((r.remainingMeters || 0) - correctRemainingMeters) > 0.001 ||
            Math.abs((r.progressPercent || 0) - correctProgressPercent) > 0.001

          if (needsUpdate) {
            await db.dailyReport.update({
              where: { id: r.id },
              data: {
                dailyMeters: correctDailyMeters,
                dailyRevenue: correctDailyRevenue,
                startReading: correctStartReading,
                endReading: correctEndReading,
                totalMeters: correctTotalMeters,
                remainingMeters: correctRemainingMeters,
                progressPercent: correctProgressPercent,
              },
            })
            results.reportsFixed++
            if (corr) results.reportsReanchored++
          }
        }

        for (const dl of driveLines) {
          // Use MAX endReading (cumulative progress) as the canonical
          // "completedLength" — this matches how field crews measure
          // pipe jacking progress.
          const maxResult = await db.dailyReport.aggregate({
            where: { driveLineId: dl.id },
            _max: { endReading: true },
          })
          // Also compute SUM dailyMeters as a fallback for the case where
          // endReading was never set but dailyMeters was.
          const sumResult = await db.dailyReport.aggregate({
            where: { driveLineId: dl.id },
            _sum: { dailyMeters: true },
          })
          const completedLength = Math.max(
            maxResult._max.endReading || 0,
            sumResult._sum.dailyMeters || 0
          )
          const progress = dl.totalLength > 0 ? (completedLength / dl.totalLength) * 100 : 0
          const newStatus =
            progress >= 100 ? 'completed'
            : completedLength > 0 ? 'in_progress'
            : 'not_started'

          await db.driveLine.update({
            where: { id: dl.id },
            data: {
              completedLength,
              progress: Math.min(progress, 100),
              status: newStatus,
            },
          })
          results.driveLinesFixed++
        }

        // Step 5: Recalculate project progress.
        // Use SUM(dailyMeters) across all reports for this project divided
        // by project.totalLength. This is the SIMPLE approach documented
        // in api-helpers.ts:recalcProgress.
        const metersAgg = await db.dailyReport.aggregate({
          where: { projectId: project.id },
          _sum: { dailyMeters: true },
        })
        const totalMeters = metersAgg._sum.dailyMeters || 0
        const totalLen = project.totalLength || 0
        const projectProgress = totalLen > 0 ? Math.min((totalMeters / totalLen) * 100, 100) : 0

        await db.project.update({
          where: { id: project.id },
          data: { progress: projectProgress },
        })
        results.projectsFixed++
      } catch (err: any) {
        results.errors.push(`Project ${project.id}: ${err.message || String(err)}`)
      }
    }

    // Invalidate dashboard cache so fresh data shows up immediately.
    invalidateCachePrefix('dashboard:')

    // SECURITY FIX: العملية تعيد كتابة مبلغات مالية — تُوثق الآن في سجل التدقيق
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user.id,
          action: 'update',
          entity: 'system',
          entityId: 'recalc-all',
          details: 'إعادة حساب شاملة: ' + results.projectsFixed + ' مشروع، ' + results.driveLinesFixed + ' خط، ' + results.reportsFixed + ' تقرير، ' + results.reportsReanchored + ' تقرير أُعيد تثبيت قراءاته' + (results.errors.length > 0 ? ' (' + results.errors.length + ' خطأ)' : ''),
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({
      success: true,
      message: 'اكتملت إعادة الحساب. تحديث لوحة التحكم الآن.',
      results,
    })
  } catch (error: any) {
    console.error('[recalc-all] Error:', error)
    // SECURITY FIX: كان يُعيد error.message الخام للعميل (تسريب تفاصيل داخلية)
    return NextResponse.json({ error: 'server_error', message: 'فشلت إعادة الحساب. حاول مرة أخرى.' }, { status: 500 })
  }
}

