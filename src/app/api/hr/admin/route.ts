// v53: لوحة إدارة الموارد البشرية — الإدارة/الموارد البشرية فقط (isHRManager)
// GET  — حالة كل الموظفين (على رأس العمل / في إجازة / منتهي العقد / معطل)،
//        الطلبات بانتظار الموافقة، الإجازات القادمة (30 يوماً)،
//        تنبيهات انتهاء العقود والجوازات والبطاقات والإقامات (60 يوماً)،
//        العطلات الرسمية، والسياسة
// POST — إجراءات الإدارة:
//   save_policy     { weekendDays, defaultAnnualDays, sickAttachRequired }
//   add_holiday     { date, name? }
//   delete_holiday  { id }
//   set_balance     { userId, annualTotal, carriedOver }
//   adjust_balance  { userId, delta, reason } — السبب إلزامي ويُسجَّل للتدقيق

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { isHRManager } from '@/lib/auth'
import { ensureHRSupport } from '@/lib/db-selfheal'
import { getOrCreateBalance, getPolicy, parseDay, fmtDay, dayKey } from '@/lib/hr'

var DOC_KINDS: Record<string, { ar: string }> = {
  passport: { ar: 'جواز السفر' },
  id: { ar: 'البطاقة الشخصية' },
  residence: { ar: 'الإقامة' },
  contract: { ar: 'العقد' },
}

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!isHRManager(me)) {
    return NextResponse.json({ error: 'forbidden', message: 'لوحة الموارد البشرية متاحة للإدارة فقط' }, { status: 403 })
  }
  try {
    await ensureHRSupport()
    var today = new Date()
    var todayKey = dayKey(today)
    var in30 = new Date(today.getTime() + 30 * 86400000)
    var in60 = new Date(today.getTime() + 60 * 86400000)

    var users = await db.user.findMany({
      where: { role: { not: 'visitor' } },
      select: {
        id: true, name: true, nameEn: true, email: true, role: true, active: true,
        jobTitle: true, department: true, workLocation: true, employeeNo: true,
        joinDate: true, contractEnd: true, absenceDays: true, lateDays: true,
        supervisorId: true,
        supervisor: { select: { name: true, nameEn: true } },
      },
      orderBy: { name: 'asc' },
    })

    var balances = await db.leaveBalance.findMany()
    var balMap: Record<string, any> = {}
    for (var b of balances) balMap[b.userId] = b

    // الإجازات المعتمدة النشطة والقادمة (خلال 30 يوماً)
    var activeLeaves = await db.leaveRequest.findMany({
      where: {
        status: 'approved',
        type: { not: 'unpaid' },
        endDate: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) },
        startDate: { lte: in30 },
      },
      select: {
        id: true, employeeId: true, type: true, startDate: true, endDate: true, days: true,
        employee: { select: { name: true, nameEn: true } },
      },
      orderBy: { startDate: 'asc' },
    })
    var leaveByEmp: Record<string, any> = {}
    var upcoming: any[] = []
    for (var lv of activeLeaves) {
      var sKey = dayKey(new Date(lv.startDate))
      var eKey = dayKey(new Date(lv.endDate))
      if (sKey <= todayKey && todayKey <= eKey) {
        if (!leaveByEmp[lv.employeeId]) leaveByEmp[lv.employeeId] = lv
      } else if (sKey > todayKey) {
        upcoming.push(lv)
      }
    }

    var employees = users.map(function(u) {
      var bal = balMap[u.id]
      var remaining = bal ? (bal.annualTotal + bal.carriedOver - bal.used) : null
      var status = 'on_duty'
      var leaveUntil: string | null = null
      if (!u.active) status = 'inactive'
      else if (u.contractEnd && new Date(u.contractEnd).getTime() < today.getTime()) status = 'contract_ended'
      else if (leaveByEmp[u.id]) {
        status = 'on_leave'
        leaveUntil = fmtDay(new Date(leaveByEmp[u.id].endDate))
      }
      return {
        id: u.id, name: u.name, nameEn: u.nameEn, email: u.email, role: u.role, active: u.active,
        jobTitle: u.jobTitle, department: u.department, workLocation: u.workLocation, employeeNo: u.employeeNo,
        joinDate: u.joinDate, contractEnd: u.contractEnd, absenceDays: u.absenceDays, lateDays: u.lateDays,
        supervisorId: u.supervisorId,
        supervisor: u.supervisor,
        remainingBalance: remaining,
        annualTotal: bal ? bal.annualTotal : null,
        carriedOver: bal ? bal.carriedOver : null,
        used: bal ? bal.used : null,
        status, leaveUntil,
      }
    })

    // تنبيهات انتهاء المستندات — خلال 60 يوماً أو منتهية بالفعل
    var docUsers = await db.user.findMany({
      where: { role: { not: 'visitor' } },
      select: {
        id: true, name: true, nameEn: true,
        passportNo: true, passportExpiry: true,
        idNo: true, idExpiry: true,
        residenceNo: true, residenceExpiry: true,
        contractEnd: true,
      },
    })
    var docAlerts: any[] = []
    for (var u of docUsers) {
      var checks: Array<[string, Date | null]> = [
        ['passport', u.passportExpiry ? new Date(u.passportExpiry) : null],
        ['id', u.idExpiry ? new Date(u.idExpiry) : null],
        ['residence', u.residenceExpiry ? new Date(u.residenceExpiry) : null],
        ['contract', u.contractEnd ? new Date(u.contractEnd) : null],
      ]
      for (var c of checks) {
        if (!c[1]) continue
        var k = dayKey(c[1])
        var daysLeft = k - todayKey
        if (daysLeft <= 60) {
          docAlerts.push({
            userId: u.id, name: u.name, nameEn: u.nameEn, kind: c[0],
            kindLabel: DOC_KINDS[c[0]].ar,
            expiry: fmtDay(c[1]),
            daysLeft,
            expired: daysLeft < 0,
          })
        }
      }
    }
    docAlerts.sort(function(a, b) { return a.daysLeft - b.daysLeft })

    var pendingCount = await db.leaveRequest.count({ where: { status: 'pending' } })

    var holidays = await db.holiday.findMany({
      orderBy: { date: 'asc' },
      take: 200,
    })

    var policy = await getPolicy()

    return NextResponse.json({
      employees,
      pendingCount,
      upcoming: upcoming.slice(0, 20).map(function(lv) {
        return {
          id: lv.id, type: lv.type, startDate: lv.startDate, endDate: lv.endDate, days: lv.days,
          employee: lv.employee,
        }
      }),
      docAlerts,
      holidays: holidays.map(function(h) {
        return { id: h.id, date: fmtDay(new Date(h.date)), name: h.name }
      }),
      policy: {
        weekendDays: policy.weekendDays,
        defaultAnnualDays: policy.defaultAnnualDays,
        sickAttachRequired: policy.sickAttachRequired,
      },
    })
  } catch (error) {
    return handleDbError(error, 'لوحة الموارد البشرية')
  }
}

export async function POST(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!isHRManager(me)) {
    return NextResponse.json({ error: 'forbidden', message: 'فقط الإدارة/الموارد البشرية يمكنها تنفيذ هذا الإجراء' }, { status: 403 })
  }
  try {
    await ensureHRSupport()
    var body = await req.json()
    var action = String(body.action || '')

    // ── حفظ السياسة ──
    if (action === 'save_policy') {
      var weekendDays = String(body.weekendDays || '')
      var days = weekendDays.split(',').map(function(s) { return parseInt(s.trim(), 10) }).filter(function(n) { return !isNaN(n) && n >= 0 && n <= 6 })
      var defaultAnnualDays = parseFloat(String(body.defaultAnnualDays ?? 30))
      if (isNaN(defaultAnnualDays) || defaultAnnualDays < 0 || defaultAnnualDays > 365) {
        return NextResponse.json({ error: 'invalid_value', message: 'الرصيد السنوي الافتراضي يجب أن يكون بين 0 و365' }, { status: 400 })
      }
      var current = await db.leavePolicy.findFirst()
      var data = {
        weekendDays: days.join(','),
        defaultAnnualDays,
        sickAttachRequired: body.sickAttachRequired !== false,
      }
      if (current) await db.leavePolicy.update({ where: { id: current.id }, data })
      else await db.leavePolicy.create({ data: { singleton: 'default', ...data } })
      return NextResponse.json({ ok: true })
    }

    // ── العطلات الرسمية ──
    if (action === 'add_holiday') {
      var date = parseDay(body.date)
      if (!date) {
        return NextResponse.json({ error: 'invalid_date', message: 'تاريخ العطلة مطلوب بصيغة YYYY-MM-DD' }, { status: 400 })
      }
      var name = body.name ? String(body.name).trim().slice(0, 200) || null : null
      await db.holiday.upsert({
        where: { date },
        update: { name },
        create: { date, name },
      })
      return NextResponse.json({ ok: true })
    }

    if (action === 'delete_holiday') {
      var hid = String(body.id || '')
      if (!hid) return NextResponse.json({ error: 'missing_fields', message: 'معرف العطلة مطلوب' }, { status: 400 })
      try {
        await db.holiday.delete({ where: { id: hid } })
      } catch {}
      return NextResponse.json({ ok: true })
    }

    // ── تحديد الرصيد الكلي ──
    if (action === 'set_balance') {
      var userId = String(body.userId || '')
      var annualTotal = parseFloat(String(body.annualTotal))
      var carriedOver = parseFloat(String(body.carriedOver ?? 0))
      if (!userId) return NextResponse.json({ error: 'missing_fields', message: 'الموظف مطلوب' }, { status: 400 })
      if (isNaN(annualTotal) || annualTotal < 0 || annualTotal > 365) {
        return NextResponse.json({ error: 'invalid_value', message: 'الرصيد السنوي يجب أن يكون بين 0 و365' }, { status: 400 })
      }
      if (isNaN(carriedOver) || carriedOver < 0 || carriedOver > 365) {
        return NextResponse.json({ error: 'invalid_value', message: 'الرصيد المرحّل يجب أن يكون بين 0 و365' }, { status: 400 })
      }
      var target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
      if (!target) return NextResponse.json({ error: 'not_found', message: 'الموظف غير موجود' }, { status: 404 })
      await getOrCreateBalance(userId)
      await db.leaveBalance.update({ where: { userId }, data: { annualTotal, carriedOver } })
      try {
        await db.auditLog.create({
          data: {
            userId: me.id, action: 'update', entity: 'leave_balance', entityId: userId,
            details: 'تحديد رصيد الإجازات لـ ' + target.name + ' — السنوي: ' + annualTotal + '، المرحّل: ' + carriedOver,
          },
        })
      } catch {}
      return NextResponse.json({ ok: true })
    }

    // ── تعديل فوري للمستخدم مع سبب إلزامي ──
    if (action === 'adjust_balance') {
      var adjUserId = String(body.userId || '')
      var delta = parseFloat(String(body.delta))
      var reason = body.reason ? String(body.reason).trim() : ''
      if (!adjUserId) return NextResponse.json({ error: 'missing_fields', message: 'الموظف مطلوب' }, { status: 400 })
      if (isNaN(delta) || delta === 0) {
        return NextResponse.json({ error: 'invalid_value', message: 'مقدار التعديل يجب أن يكون رقماً لا يساوي صفر' }, { status: 400 })
      }
      if (!reason) {
        return NextResponse.json({ error: 'missing_fields', message: 'سبب تعديل الرصيد إلزامي' }, { status: 400 })
      }
      var adjTarget = await db.user.findUnique({ where: { id: adjUserId }, select: { id: true, name: true } })
      if (!adjTarget) return NextResponse.json({ error: 'not_found', message: 'الموظف غير موجود' }, { status: 404 })
      var adjBalance = await getOrCreateBalance(adjUserId)
      var newUsed = Math.max(0, adjBalance.used + delta)
      var applied = newUsed - adjBalance.used
      await db.$transaction([
        db.leaveBalance.update({ where: { userId: adjUserId }, data: { used: newUsed } }),
        db.leaveAdjustment.create({
          data: { userId: adjUserId, delta: applied, reason: reason.slice(0, 500), byId: me.id },
        }),
      ])
      try {
        await db.auditLog.create({
          data: {
            userId: me.id, action: 'update', entity: 'leave_balance', entityId: adjUserId,
            details: 'تعديل رصيد ' + adjTarget.name + ' بمقدار ' + applied + ' يوم — السبب: ' + reason.slice(0, 200),
          },
        })
      } catch {}
      return NextResponse.json({ ok: true, applied })
    }

    return NextResponse.json({ error: 'invalid_value', message: 'إجراء غير معروف' }, { status: 400 })
  } catch (error) {
    return handleDbError(error, 'إجراء الموارد البشرية')
  }
}
