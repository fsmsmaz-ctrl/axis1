// v68: استعادة طلبات الإجازة — القائمة وإنشاء الطلب
// خلال إعادة هيكلة v62 (دمج قسمي «ملفي الوظيفي» و«الإجازات» في الملف الشخصي)
// حُذفت مسارات طلبات الإجازة بالخطأ وبقيت الواجهة بلا خادم — ففقد الموظفون
// القدرة على تقديم أي طلب إجازة، وبقيت لوحة الموارد البشرية بلا طلبات لتدقيقها.
// هذه الاستعادة تُكمل تصميم v62: الملف الشخصي هو الموطن الوحيد — الواجهة مدمجة
// في «بياناتي الوظيفية والإجازات» (hr-file-page) والخادم هنا.
//
// v118: خوارزمية الإجازات التلقائية — طلب السنوية لا يُرفض بسبب الرصيد:
// إذا تجاوز الطلب الاستحقاق يُقبل الطلب ويصبح الرصيد سالباً عند الاعتماد،
// ويتعافى تلقائياً 2.5 يوم مع اكتمال كل شهر من تاريخ بدء العقد.
// GET  — طلباتي + رصيدي (الفعلي المحسوب آلياً) + السياسة والعطلات (لاحتساب الأيام في النموذج) + أعلام الصلاحية
//        ?scope=team — طلبات فريق المسؤول المباشر (أو كل الطلبات للإدارة)
// POST — إنشاء طلب جديد بحالة «بانتظار الموافقة»:
//   • حساب الأيام تلقائياً وفق أيام العمل (استبعاد نهاية الأسبوع من السياسة والعطلات الرسمية)
//   • الإجازة السنوية مسموحة حتى لو تجاوزت الرصيد — يصبح الرصيد سالباً عند الاعتماد (v118)
//   • منع التداخل مع طلب آخر (بانتظار أو معتمد) لنفس الموظف
//   • المستند إلزامي للإجازة المرضية (وفق السياسة)
//   • إشعار للمسؤول المباشر (أو الإدارة عند غيابه) + إشعار استلام للموظف
//   • رابط التنبيهات «profile» — الملف الشخصي هو موطن الإجازات بعد v62

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { isHRManager, normalizeRole } from '@/lib/auth'
import { ensureHRSupport } from '@/lib/db-selfheal'
import { notifyUsers } from '@/lib/notify'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import {
  getOrCreateBalance, getPolicy, parseWeekend, parseDay, dayKey,
  countWorkingDays, loadHolidayKeys, fmtDay, LEAVE_TYPE_LABELS_AR,
  computeCompleteness,
} from '@/lib/hr'
import { computeEffectiveLeave } from '@/lib/leave-accrual'

var MAX_ATTACHMENT_CHARS = 6000000 // ~4.5MB base64 — نفس حد صور الفواتير

function validAttachment(s: string): boolean {
  return /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/.test(s) && s.length <= MAX_ATTACHMENT_CHARS
}

const VALID_TYPES = ['annual', 'sick', 'emergency', 'unpaid', 'other']

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  // v68: بوابة القسم بعد حذف صلاحية hr_leave في v62 — كل موظف (غير الزائر)
  // يرى بيانات إجازاته ويقدم طلباته من ملفه الشخصي، والزائر مستثنى
  if (normalizeRole(me.role) === 'visitor') {
    return NextResponse.json({ error: 'forbidden', message: 'طلبات الإجازة غير متاحة لحساب الزائر' }, { status: 403 })
  }
  var searchParams = new URL(req.url).searchParams
  var scope = searchParams.get('scope') || 'mine'
  try {
    await ensureHRSupport()
    var manager = isHRManager(me)
    var policy = await getPolicy()
    var balance = await getOrCreateBalance(me.id, policy.defaultAnnualDays)
    var holidays = await db.holiday.findMany({
      orderBy: { date: 'asc' },
      take: 200,
      select: { id: true, date: true, name: true },
    })

    // طلبات الفريق: مرؤوسو المسؤول مباشرة — والإدارة ترى كل الطلبات
    var teamRequests: any[] = []
    var teamCount = 0
    if (manager) {
      teamCount = await db.user.count({ where: { role: { not: 'visitor' }, active: true } })
    } else {
      teamCount = await db.user.count({ where: { supervisorId: me.id } })
    }
    if (scope === 'team' && (manager || teamCount > 0)) {
      teamRequests = await db.leaveRequest.findMany({
        where: manager ? { employee: { role: { not: 'visitor' } } } : { employee: { supervisorId: me.id } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 120,
        select: {
          id: true, type: true, startDate: true, endDate: true, days: true, status: true,
          reason: true, substituteName: true, attachmentName: true,
          reviewNote: true, createdAt: true, reviewedAt: true,
          employeeId: true,
          employee: { select: { id: true, name: true, nameEn: true, role: true, jobTitle: true, supervisorId: true, contractStart: true, joinDate: true } },
          reviewedBy: { select: { name: true, nameEn: true } },
        },
      })
      // بيانات المرفقات تُجلب لطلبات الانتظار فقط — لا تُرسل كل المرفقات الثقيلة في القائمة
      var pendingWithAtt = teamRequests.filter(function(r) { return r.status === 'pending' && r.attachmentName })
      var attMap: Record<string, string> = {}
      if (pendingWithAtt.length > 0) {
        var attRows = await db.leaveRequest.findMany({
          where: { id: { in: pendingWithAtt.map(function(r) { return r.id }) } },
          select: { id: true, attachmentData: true },
        })
        for (var a of attRows) {
          if (a.attachmentData) attMap[a.id] = a.attachmentData
        }
      }
      // v118: أرصدة أصحاب الطلبات السنوية — محسوبة آلياً من تاريخ بدء العقد
      // (المستحق − المستخدم) لتساعد المعتمد على القرار، وسالبة إن تجاوز الاستحقاق
      var annualReqs = teamRequests.filter(function(r) { return r.type === 'annual' })
      var balancesById: Record<string, any> = {}
      if (annualReqs.length > 0) {
        var empIds = Array.from(new Set(annualReqs.map(function(r) { return r.employeeId })))
        var bals = await db.leaveBalance.findMany({ where: { userId: { in: empIds } } })
        for (var b of bals) balancesById[b.userId] = b
      }
      teamRequests = teamRequests.map(function(r) {
        var b = balancesById[r.employeeId]
        var eff = computeEffectiveLeave(r.employee || {}, b ? b.used : 0)
        return {
          id: r.id, type: r.type, startDate: r.startDate, endDate: r.endDate, days: r.days,
          status: r.status, reason: r.reason, substituteName: r.substituteName,
          attachmentName: r.attachmentName, attachmentData: attMap[r.id] || null,
          reviewNote: r.reviewNote, createdAt: r.createdAt, reviewedAt: r.reviewedAt,
          employee: r.employee,
          remainingBalance: eff.basis ? eff.remaining : null,
        }
      })
    }

    var requests = await db.leaveRequest.findMany({
      where: { employeeId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true, type: true, startDate: true, endDate: true, days: true, status: true,
        reason: true, substituteName: true, attachmentName: true, attachmentData: true,
        reviewNote: true, createdAt: true, reviewedAt: true,
        reviewedBy: { select: { name: true, nameEn: true } },
      },
    })

    // v72: بيانات المرفقات الثقيلة تُجلب للطلبات المعلقة فقط — كان يُرسل مرفق
    // كل الطلبات الستين (حتى 4.5MB لكل مرفق) في كل زيارة للملف الشخصي فتتجمد الصفحة
    // على الأجهزة الضعيفة (نفس نمط تحسين teamRequests أعلاه)
    var pendingWithMyAtt: string[] = []
    for (var ri = 0; ri < requests.length; ri++) {
      if (requests[ri].status === 'pending' && requests[ri].attachmentName) pendingWithMyAtt.push(requests[ri].id)
    }
    var myAttMap: Record<string, string> = {}
    if (pendingWithMyAtt.length > 0) {
      var myAttRows = await db.leaveRequest.findMany({
        where: { id: { in: pendingWithMyAtt } },
        select: { id: true, attachmentData: true },
      })
      for (var ma of myAttRows) {
        if (ma.attachmentData) myAttMap[ma.id] = ma.attachmentData
      }
    }
    var requestsOut = requests.map(function(r: any) {
      return { ...r, attachmentData: myAttMap[r.id] || null }
    })

    // v68: اكتمال بيانات الموظف — نفس بوابات hr-file-page (للاتساق مع أي واجهة تستدعي هذا المسار)
    var meRow = await db.user.findUnique({
      where: { id: me.id },
      select: { jobTitle: true, department: true, joinDate: true, contractStart: true },
    })
    var completeness = computeCompleteness(meRow || {}, balance)
    // v118: الرصيد الفعلي المحسوب آلياً — الاستحقاق من تاريخ بدء العقد/الالتحاق
    var effectiveBalance = computeEffectiveLeave(meRow || {}, balance.used)

    return NextResponse.json({
      requests: requestsOut,
      teamRequests,
      teamCount,
      isHR: manager,
      balance,
      // v118: الرصيد الفعلي المحسوب آلياً — الواجهة تعرضه بدل الحساب اليدوي القديم
      effectiveBalance,
      completeness,
      policy: {
        weekendDays: policy.weekendDays,
        defaultAnnualDays: policy.defaultAnnualDays,
        sickAttachRequired: policy.sickAttachRequired,
      },
      holidays: holidays.map(function(h) {
        return { date: fmtDay(new Date(h.date)), name: h.name }
      }),
    })
  } catch (error) {
    return handleDbError(error, 'جلب بيانات الإجازات')
  }
}

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (normalizeRole(me.role) === 'visitor') {
    return NextResponse.json({ error: 'forbidden', message: 'تقديم طلبات الإجازة غير متاح لحساب الزائر' }, { status: 403 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensureHRSupport()
    var body = await req.json()
    var type = String(body.type || '')
    if (VALID_TYPES.indexOf(type) === -1) {
      return NextResponse.json({ error: 'invalid_value', message: 'نوع الإجازة غير صحيح' }, { status: 400 })
    }
    var start = parseDay(body.startDate)
    var end = parseDay(body.endDate)
    if (!start || !end) {
      return NextResponse.json({ error: 'invalid_date', message: 'تاريخ البداية والنهاية مطلوبان بصيغة YYYY-MM-DD' }, { status: 400 })
    }
    if (end.getTime() < start.getTime()) {
      return NextResponse.json({ error: 'invalid_date', message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له' }, { status: 400 })
    }
    var reason = body.reason ? String(body.reason).trim().slice(0, 1000) : null
    var substituteName = body.substituteName ? String(body.substituteName).trim().slice(0, 120) || null : null

    // المستند المرفق — إلزامي للمرضية وفق السياسة
    var policy = await getPolicy()
    var attachmentData: string | null = null
    var attachmentName: string | null = null
    if (body.attachmentData) {
      var att = String(body.attachmentData)
      if (!validAttachment(att)) {
        return NextResponse.json({ error: 'invalid_value', message: 'المرفق يجب أن يكون صورة أو PDF بحجم لا يتجاوز 4.5 ميغابايت' }, { status: 400 })
      }
      attachmentData = att
      attachmentName = body.attachmentName ? String(body.attachmentName).slice(0, 200) : 'مستند'
    }
    if (type === 'sick' && policy.sickAttachRequired && !attachmentData) {
      return NextResponse.json({ error: 'missing_fields', message: 'إرفاق مستند طبي إلزامي للإجازة المرضية' }, { status: 400 })
    }

    // حساب الأيام تلقائياً وفق أيام العمل والعطلات المعتمدة
    var weekend = parseWeekend(policy.weekendDays)
    var holidayKeys = await loadHolidayKeys()
    var days = countWorkingDays(start, end, weekend, holidayKeys)
    if (days <= 0) {
      return NextResponse.json({ error: 'invalid_date', message: 'الفترة المختارة تقع كاملة ضمن نهاية الأسبوع أو العطلات الرسمية' }, { status: 400 })
    }

    // منع التداخل مع طلب آخر لنفس الموظف (بانتظار أو معتمد)
    var overlap = await db.leaveRequest.findFirst({
      where: {
        employeeId: me.id,
        status: { in: ['pending', 'approved'] },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { id: true, type: true, startDate: true, endDate: true },
    })
    if (overlap) {
      return NextResponse.json({
        error: 'overlap',
        message: 'يتعارض الطلب مع إجازة أخرى مسجلة لك (' + (LEAVE_TYPE_LABELS_AR[overlap.type] || overlap.type) + ' من ' + fmtDay(new Date(overlap.startDate)) + ' إلى ' + fmtDay(new Date(overlap.endDate)) + ')',
      }, { status: 400 })
    }

    // الإجازة السنوية — v118: لا رفض بسبب الرصيد. نحسب الرصيد الفعلي ونرفق
    // إشارة willGoNegative ليعرف الموظف أن رصيده سيسالب عند الاعتماد ويتعافى شهرياً
    var remaining: number | null = null
    var willGoNegative = false
    if (type === 'annual') {
      var balance = await getOrCreateBalance(me.id, policy.defaultAnnualDays)
      var meRowA = await db.user.findUnique({ where: { id: me.id }, select: { contractStart: true, joinDate: true } })
      var eff = computeEffectiveLeave(meRowA || {}, balance.used)
      remaining = eff.remaining
      willGoNegative = days > remaining
    }

    var created = await db.leaveRequest.create({
      data: {
        employeeId: me.id,
        type,
        startDate: start,
        endDate: end,
        days,
        reason,
        substituteName,
        attachmentName,
        attachmentData,
        status: 'pending',
      },
    })

    // ── الإشعارات ──
    var typeLabel = LEAVE_TYPE_LABELS_AR[type] || type
    var periodMsg = me.name + ' — ' + typeLabel + ' من ' + fmtDay(start) + ' إلى ' + fmtDay(end) + ' (' + days + ' أيام عمل)'
    try {
      // 1) إشعار استلام للموظف
      await db.notification.create({
        data: {
          userId: me.id,
          type: 'leave_submitted',
          title: 'تم استلام طلب الإجازة',
          message: 'طلبك (' + typeLabel + ' من ' + fmtDay(start) + ' إلى ' + fmtDay(end) + ') قيد الانتظار — سيُحوَّل إلى المسؤول المباشر',
          severity: 'info',
          link: 'profile',
          entityType: 'leave_request',
          entityId: created.id,
        },
      })
      // 2) توجيه الطلب للمسؤول المباشر — وعند غيابه للإدارة/الموارد البشرية
      var meRow2 = await db.user.findUnique({ where: { id: me.id }, select: { supervisorId: true } })
      var supId = meRow2?.supervisorId || null
      if (supId) {
        await db.notification.create({
          data: {
            userId: supId,
            type: 'leave_submitted',
            title: 'طلب إجازة جديد بانتظار موافقتك',
            message: periodMsg,
            severity: 'info',
            link: 'profile',
            entityType: 'leave_request',
            entityId: created.id,
          },
        })
      } else {
        await notifyUsers({
          type: 'leave_submitted',
          title: 'طلب إجازة جديد (بلا مسؤول مباشر)',
          message: periodMsg,
          severity: 'info',
          link: 'profile',
          entityType: 'leave_request',
          entityId: created.id,
          permissions: [],
          roles: ['top_management'],
          includeSystemAdmin: true,
          excludeUserIds: [me.id],
        })
      }
    } catch (notifyErr) {
      console.warn('v68 leave notifications skipped:', notifyErr)
    }

    return NextResponse.json({ request: created, remaining, willGoNegative })
  } catch (error) {
    return handleDbError(error, 'إنشاء طلب الإجازة')
  }
}
