import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { isTaskManager } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────
// تقرير الأداء الشهري لإدارة المهام — لكل موظف:
//  المستحقة / المغلقة / الالتزام بالموعد / المتأخرة / متوسط التأخير
//  / متوسط وقت الإنجاز / المعادة / الاعتماد من أول مراجعة / المفتوحة
//  / المتوقفة بسبب جهات خارجية
// قواعد العد:
//  - المهام الملغاة مستبعدة من التقييم كلياً
//  - مدة الانتظار بسبب جهة خارجية (waitingMinutes) لا تُحسب تأخيراً على الموظف
//  - تقرير الأداء للمديرين فقط (بيانات جماعية عن الموظفين)
// ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!isTaskManager(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'تقارير الأداء متاحة للإدارة فقط' }, { status: 403 })
    }

    const sp = new URL(req.url).searchParams
    const monthParam = sp.get('month') // YYYY-MM
    const now = new Date()
    let year = now.getUTCFullYear()
    let month = now.getUTCMonth() // 0-based
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      year = parseInt(monthParam.slice(0, 4))
      month = parseInt(monthParam.slice(5, 7)) - 1
    }
    const startUTC = new Date(Date.UTC(year, month, 1))
    const endUTC = new Date(Date.UTC(year, month + 1, 1))
    const monthKey = monthParam || startUTC.toISOString().slice(0, 7)

    // مهام شهر محدد: المستحقة (dueDate داخل الشهر) أو المغلقة (closedAt داخل الشهر)
    const result = await safeDbOp(
      () => db.task.findMany({
        where: {
          OR: [
            { dueDate: { gte: startUTC, lt: endUTC } },
            { closedAt: { gte: startUTC, lt: endUTC } },
          ],
        },
        select: {
          id: true, assigneeId: true, status: true, size: true, dueDate: true,
          createdAt: true, closedAt: true, returnCount: true, closedOnFirstReview: true,
          waitingMinutes: true, waitingSince: true, cancelReason: true,
          assignee: { select: { id: true, name: true, nameEn: true, role: true, active: true } },
        },
      }),
      'جلب بيانات تقرير الأداء'
    )
    if (!result.success) return result.response
    const tasks = result.data as any[]

    type PerEmployee = {
      userId: string
      name: string
      nameEn: string | null
      dueTasks: number
      closedTasks: number
      onTimeTasks: number
      onTimeRate: number
      lateTasks: number
      avgDelayHours: number
      avgCompletionHours: number
      returnedCount: number
      firstReviewApproved: number
      firstReviewRate: number
      openTasks: number
      blockedByExternal: number
      cancelledExcluded: number
      sizeBreakdown: Record<string, { due: number; closed: number }>
      score: number
    }

    const byUser = new Map<string, PerEmployee>()
    const nowMs = Date.now()

    function ensure(u: any): PerEmployee {
      let e = byUser.get(u.id)
      if (!e) {
        e = {
          userId: u.id, name: u.name, nameEn: u.nameEn,
          dueTasks: 0, closedTasks: 0, onTimeTasks: 0, onTimeRate: 0,
          lateTasks: 0, avgDelayHours: 0, avgCompletionHours: 0,
          returnedCount: 0, firstReviewApproved: 0, firstReviewRate: 0,
          openTasks: 0, blockedByExternal: 0, cancelledExcluded: 0,
          sizeBreakdown: {}, score: 0,
        }
        byUser.set(u.id, e)
      }
      return e
    }

    // مُجمّعات لحساب المتوسطات
    const delaySamples = new Map<string, number[]>()
    const completionSamples = new Map<string, number[]>()

    for (const t of tasks) {
      const e = ensure(t.assignee)
      const dueInMonth = new Date(t.dueDate) >= startUTC && new Date(t.dueDate) < endUTC
      const closedInMonth = t.closedAt && new Date(t.closedAt) >= startUTC && new Date(t.closedAt) < endUTC

      if (t.status === 'cancelled') {
        if (dueInMonth || closedInMonth) e.cancelledExcluded += 1
        continue // الملغاة خارج التقييم
      }

      // مدة الانتظار الحالية (إن كانت لا تزال في حالة انتظار تُضاف للتراكمية وقت الحساب)
      let waitingMin = t.waitingMinutes || 0
      if (t.status === 'waiting' && t.waitingSince) {
        waitingMin += Math.max(0, Math.floor((nowMs - new Date(t.waitingSince).getTime()) / 60000))
      }

      if (dueInMonth) {
        e.dueTasks += 1
        e.returnedCount += t.returnCount || 0
        const sb = e.sizeBreakdown[t.size] || (e.sizeBreakdown[t.size] = { due: 0, closed: 0 })
        sb.due += 1

        const isOpen = !['closed'].includes(t.status)
        if (isOpen) e.openTasks += 1
        if (t.status === 'waiting') e.blockedByExternal += 1

        // التأخير الفعلي على الموظف = بعد الموعد ناقص مدد الانتظار المسجلة
        const effectiveNow = (t.closedAt ? new Date(t.closedAt).getTime() : nowMs) - waitingMin * 60000
        const delayMs = effectiveNow - new Date(t.dueDate).getTime()
        const isLate = delayMs > 0
        if (isLate) e.lateTasks += 1

        if (t.status === 'closed' && closedInMonth) {
          e.closedTasks += 1
          sb.closed += 1
          if (!isLate) e.onTimeTasks += 1
          if (t.closedOnFirstReview) e.firstReviewApproved += 1
          const dArr = delaySamples.get(e.userId) || []
          dArr.push(Math.max(0, delayMs) / 3600000)
          delaySamples.set(e.userId, dArr)
          const cArr = completionSamples.get(e.userId) || []
          cArr.push(Math.max(0, (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) - waitingMin * 60000) / 3600000)
          completionSamples.set(e.userId, cArr)
        }
      } else if (closedInMonth) {
        // أُغلقت خلال الشهر لكن استحقاقها من شهر سابق — تحتسب في المغلقة والالتزام
        e.closedTasks += 1
        const waiting = waitingMin
        const effectiveClosed = new Date(t.closedAt).getTime() - waiting * 60000
        const delayMs = effectiveClosed - new Date(t.dueDate).getTime()
        if (delayMs <= 0) e.onTimeTasks += 1
        else {
          e.lateTasks += 0 // لا نزداد المتأخرة هنا لعدم ازدواج الاستحقاق
          const dArr = delaySamples.get(e.userId) || []
          dArr.push(delayMs / 3600000)
          delaySamples.set(e.userId, dArr)
        }
        if (t.closedOnFirstReview) e.firstReviewApproved += 1
        const cArr = completionSamples.get(e.userId) || []
        cArr.push(Math.max(0, (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()) - waiting * 60000) / 3600000)
        completionSamples.set(e.userId, cArr)
      }
    }

    const employees = Array.from(byUser.values()).map((e) => {
      e.onTimeRate = e.closedTasks > 0 ? (e.onTimeTasks / e.closedTasks) * 100 : 0
      e.firstReviewRate = e.closedTasks > 0 ? (e.firstReviewApproved / e.closedTasks) * 100 : 0
      const dArr = delaySamples.get(e.userId) || []
      e.avgDelayHours = dArr.length > 0 ? dArr.reduce((a, b) => a + b, 0) / dArr.length : 0
      const cArr = completionSamples.get(e.userId) || []
      e.avgCompletionHours = cArr.length > 0 ? cArr.reduce((a, b) => a + b, 0) / cArr.length : 0
      // مؤشر مبدئي قابل للتعديل: 50% التزام بالموعد + 30% اعتماد من أول مراجعة + 20% إغلاق المستحق
      const closureRate = e.dueTasks > 0 ? Math.min(100, (e.closedTasks / e.dueTasks) * 100) : 0
      e.score = 0.5 * e.onTimeRate + 0.3 * e.firstReviewRate + 0.2 * closureRate
      return e
    }).sort((a, b) => b.score - a.score)

    const totals = {
      month: monthKey,
      employees: employees.length,
      dueTasks: employees.reduce((s, e) => s + e.dueTasks, 0),
      closedTasks: employees.reduce((s, e) => s + e.closedTasks, 0),
      lateTasks: employees.reduce((s, e) => s + e.lateTasks, 0),
      openTasks: employees.reduce((s, e) => s + e.openTasks, 0),
      blockedByExternal: employees.reduce((s, e) => s + e.blockedByExternal, 0),
      cancelledExcluded: employees.reduce((s, e) => s + e.cancelledExcluded, 0),
      note: 'الملغاة مستبعدة من التقييم — مدد الانتظار بسبب جهات خارجية لا تُحسب تأخيراً على الموظف',
    }

    return NextResponse.json({ report: { month: monthKey, totals, employees } })
  } catch (error: any) {
    return handleDbError(error, 'توليد تقرير الأداء')
  }
}
