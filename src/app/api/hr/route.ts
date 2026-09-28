// v53: الملف الوظيفي — قراءة بيانات الموظف الوظيفية وتحديثها
// GET  ?userId=...  — الملف الوظيفي (الذات افتراضياً) + الرصيد + سجل الإجازات + تعديلات الرصيد
//   • الموظف يرى ملفه فقط؛ الإدارة/الموارد البشرية (isHRManager) ترى أي ملف وتحصل على قائمة الموظفين
//   • سرية الرواتب: baseSalary/allowances تُعاد فقط للموظف نفسه أو مدير الموارد البشرية —
//     حظر سرية على مستوى الخادم لا يتأثر بصلاحيات الأقسام المخصصة
// PUT  — تعديل الملف الوظيفي (الإدارة/الموارد البشرية فقط) مع تسجيل العملية في سجل التدقيق

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { isHRManager } from '@/lib/auth'
import { ensureHRSupport } from '@/lib/db-selfheal'
import { getOrCreateBalance, getPolicy, parseDay, computeCompleteness } from '@/lib/hr'

const hrUserSelect = {
  id: true, email: true, name: true, nameEn: true, role: true, phone: true, active: true,
  employeeNo: true, jobTitle: true, department: true, workLocation: true,
  supervisorId: true, joinDate: true, contractStart: true, contractEnd: true,
  baseSalary: true, allowances: true,
  passportNo: true, passportExpiry: true, idNo: true, idExpiry: true, residenceNo: true, residenceExpiry: true,
  absenceDays: true, lateDays: true,
  supervisor: { select: { id: true, name: true, nameEn: true, jobTitle: true } },
}

export async function GET(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  var searchParams = new URL(req.url).searchParams
  var targetId = searchParams.get('userId') || me.id
  var manager = isHRManager(me)
  if (targetId !== me.id && !manager) {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية الاطلاع على ملفات الموظفين' }, { status: 403 })
  }
  try {
    await ensureHRSupport()
    var target: any = await db.user.findUnique({ where: { id: targetId }, select: hrUserSelect })
    if (!target) {
      return NextResponse.json({ error: 'not_found', message: 'الموظف غير موجود' }, { status: 404 })
    }
    // سرية الرواتب — تُحذف من الرد لمن غير المخوّل
    var canSeeSalary = manager || targetId === me.id
    if (!canSeeSalary) {
      delete target.baseSalary
      delete target.allowances
    }
    var policy = await getPolicy()
    var balance = await getOrCreateBalance(targetId, policy.defaultAnnualDays)
    // v61: اكتمال بيانات الموظف — يحكم ظهور الملف والإجازات للموظف نفسه
    var completeness = computeCompleteness(target, balance)
    var history = await db.leaveRequest.findMany({
      where: { employeeId: targetId },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true, type: true, startDate: true, endDate: true, days: true, status: true,
        reason: true, substituteName: true, reviewNote: true, attachmentName: true, createdAt: true,
        reviewedBy: { select: { name: true, nameEn: true } },
      },
    })
    var adjustments = await db.leaveAdjustment.findMany({
      where: { userId: targetId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, delta: true, reason: true, createdAt: true,
        by: { select: { name: true, nameEn: true } },
      },
    })
    var employees: any[] = []
    var roster: any[] = []
    if (manager) {
      employees = await db.user.findMany({
        where: { role: { not: 'visitor' } },
        select: { id: true, name: true, nameEn: true, role: true, jobTitle: true, active: true,
          // v61: حقول اكتمال البيانات لقائمة «تعبئة بيانات المستخدمين»
          department: true, joinDate: true, employeeNo: true },
        orderBy: { name: 'asc' },
      })
      // v61: قائمة تعبئة بيانات الموظفين — حالة الاكتمال لكل موظف (وظيفية + إجازة)
      var balRows = await db.leaveBalance.findMany({
        select: { userId: true, annualTotal: true, carriedOver: true, used: true, configured: true },
      })
      var balByUser: Record<string, any> = {}
      for (var bb of balRows) balByUser[bb.userId] = bb
      roster = employees.map(function(u: any) {
        var ub = balByUser[u.id] || null
        var c = computeCompleteness(u, ub)
        return {
          id: u.id, name: u.name, nameEn: u.nameEn, role: u.role, active: u.active,
          jobTitle: u.jobTitle, department: u.department, joinDate: u.joinDate, employeeNo: u.employeeNo,
          jobComplete: c.job, leaveComplete: c.leave, complete: c.complete, missing: c.missing,
          remainingBalance: ub ? (ub.annualTotal + ub.carriedOver - ub.used) : null,
        }
      })
    }
    return NextResponse.json({
      profile: target,
      canEdit: manager,
      canSeeSalary,
      balance,
      history,
      adjustments,
      employees,
      // v61
      completeness,
      roster,
    })
  } catch (error) {
    return handleDbError(error, 'جلب الملف الوظيفي')
  }
}

// ── تعديل الملف الوظيفي (الإدارة/الموارد البشرية فقط) ──
export async function PUT(req: NextRequest) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  if (!isHRManager(me)) {
    return NextResponse.json({ error: 'forbidden', message: 'فقط الإدارة/الموارد البشرية يمكنها تعديل الملفات الوظيفية' }, { status: 403 })
  }
  try {
    await ensureHRSupport()
    var body = await req.json()
    var userId = String(body.userId || '')
    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف الموظف مطلوب' }, { status: 400 })
    }
    var target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true } })
    if (!target) {
      return NextResponse.json({ error: 'not_found', message: 'الموظف غير موجود' }, { status: 404 })
    }

    // قائمة بيضاء للحقول المسموح تعديلها
    var patch: Record<string, any> = {}

    var textFields = ['employeeNo', 'jobTitle', 'department', 'workLocation', 'passportNo', 'idNo', 'residenceNo']
    for (var i = 0; i < textFields.length; i++) {
      var f = textFields[i]
      if (f in body) {
        var v = body[f] === null || body[f] === undefined ? null : String(body[f]).trim() || null
        patch[f] = v
      }
    }

    var dateFields = ['joinDate', 'contractStart', 'contractEnd', 'passportExpiry', 'idExpiry', 'residenceExpiry']
    for (var d = 0; d < dateFields.length; d++) {
      var df = dateFields[d]
      if (df in body) {
        if (body[df] === null || body[df] === undefined || body[df] === '') {
          patch[df] = null
        } else {
          var parsed = parseDay(String(body[df]))
          if (!parsed) {
            return NextResponse.json({ error: 'invalid_date', message: 'صيغة تاريخ غير صحيحة في أحد الحقول (المطلوب YYYY-MM-DD)' }, { status: 400 })
          }
          patch[df] = parsed
        }
      }
    }

    var numFields = ['baseSalary', 'allowances', 'absenceDays', 'lateDays']
    for (var n = 0; n < numFields.length; n++) {
      var nf = numFields[n]
      if (nf in body) {
        if (body[nf] === null || body[nf] === undefined || body[nf] === '') {
          patch[nf] = nf === 'absenceDays' || nf === 'lateDays' ? 0 : null
        } else {
          var num = parseFloat(String(body[nf]))
          if (isNaN(num) || num < 0) {
            return NextResponse.json({ error: 'invalid_value', message: 'قيمة رقمية غير صحيحة في أحد الحقول' }, { status: 400 })
          }
          patch[nf] = num
        }
      }
    }

    // المسؤول المباشر — يجب أن يكون مستخدماً موجوداً وغير الزائر وغير الموظف نفسه
    if ('supervisorId' in body) {
      var supId = body.supervisorId ? String(body.supervisorId) : null
      if (supId) {
        if (supId === userId) {
          return NextResponse.json({ error: 'invalid_value', message: 'لا يمكن أن يكون الموظف مسؤولاً مباشراً عن نفسه' }, { status: 400 })
        }
        var sup = await db.user.findUnique({ where: { id: supId }, select: { id: true, role: true } })
        if (!sup || sup.role === 'visitor') {
          return NextResponse.json({ error: 'invalid_reference', message: 'المسؤول المباشر المحدد غير صالح' }, { status: 400 })
        }
      }
      patch.supervisorId = supId
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'missing_fields', message: 'لا توجد بيانات للتحديث' }, { status: 400 })
    }

    var before = await db.user.findUnique({
      where: { id: userId },
      select: {
        employeeNo: true, jobTitle: true, department: true, workLocation: true, supervisorId: true,
        joinDate: true, contractStart: true, contractEnd: true, baseSalary: true, allowances: true,
        passportNo: true, passportExpiry: true, idNo: true, idExpiry: true, residenceNo: true, residenceExpiry: true,
        absenceDays: true, lateDays: true,
      },
    }) as Record<string, any> | null

    await db.user.update({ where: { id: userId }, data: patch })

    // سجل التدقيق — من عدّل الملف ومتى (تُسجَّل الحقول المتغيرة فقط دون القيم المالية كاملة)
    try {
      var changed: string[] = []
      for (var k of Object.keys(patch)) {
        var oldV = before ? before[k] : undefined
        var newV = patch[k]
        var oldS = oldV instanceof Date ? oldV.toISOString().slice(0, 10) : String(oldV ?? '—')
        var newS = newV instanceof Date ? newV.toISOString().slice(0, 10) : String(newV ?? '—')
        if (oldS !== newS) changed.push(k + ': ' + oldS + ' ← ' + newS)
      }
      await db.auditLog.create({
        data: {
          userId: me.id,
          action: 'update',
          entity: 'hr_file',
          entityId: userId,
          details: 'تحديث الملف الوظيفي لـ ' + target.name + (changed.length ? ' — ' + changed.join('، ') : ' — بلا تغييرات فعلية'),
        },
      })
    } catch (logErr) {
      console.warn('v53 hr_file audit log skipped:', logErr)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleDbError(error, 'تحديث الملف الوظيفي')
  }
}
