// v68: استعادة البت في طلبات الإجازة — موافقة / رفض (السبب إلزامي) / إلغاء
// خلال إعادة هيكلة v62 حُذف هذا المسار بالخطأ مع قائمة الطلبات — فتعطلت
// دورة الاعتماد كاملة. الاستعادة تُكمل تصميم v62: الواجهة مدمجة في الملف
// الشخصي ورابط التنبيهات «profile» بدل الصفحة المستقلة المحذوفة.
//
// PATCH /api/hr/leave/[id]  body: { action: 'approve' | 'reject' | 'cancel', note? }
// • الموافقة/الرفض: المسؤول المباشر (employee.supervisorId) أو الإدارة/الموارد البشرية
//   (isHRManager يحترم مفتاح hr_manage من إدارة المستخدمين — v67)
// • الموافقة على السنوية تخصم الأيام من الرصيد تلقائياً (مع إعادة فحص الكفاية)
// • الإلغاء: الموظف لطلبه المعلق؛ الإدارة أي طلب — وإلغاء المعتمد السنوي يُرجع الرصيد
// • إشعار للموظف بالقرار + نسخة للإدارة/الموارد البشرية

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'
import { isHRManager } from '@/lib/auth'
import { ensureHRSupport } from '@/lib/db-selfheal'
import { notifyUsers } from '@/lib/notify'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { getOrCreateBalance, getPolicy, fmtDay, LEAVE_TYPE_LABELS_AR } from '@/lib/hr'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  var me = await getAuthUser(req)
  if (!me) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429 })
  }
  try {
    await ensureHRSupport()
    var { id } = await params
    var body = await req.json()
    var action = String(body.action || '')
    var note = body.note ? String(body.note).trim().slice(0, 1000) : null
    if (['approve', 'reject', 'cancel'].indexOf(action) === -1) {
      return NextResponse.json({ error: 'invalid_value', message: 'إجراء غير معروف' }, { status: 400 })
    }

    var request = await db.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true, employeeId: true, type: true, startDate: true, endDate: true, days: true, status: true,
        employee: { select: { id: true, name: true, nameEn: true, supervisorId: true } },
      },
    })
    if (!request) {
      return NextResponse.json({ error: 'not_found', message: 'طلب الإجازة غير موجود' }, { status: 404 })
    }

    var manager = isHRManager(me)
    var isSupervisor = request.employee.supervisorId === me.id
    var isOwner = request.employeeId === me.id
    var typeLabel = LEAVE_TYPE_LABELS_AR[request.type] || request.type
    var periodMsg = typeLabel + ' من ' + fmtDay(new Date(request.startDate)) + ' إلى ' + fmtDay(new Date(request.endDate))

    // ── الموافقة / الرفض ──
    if (action === 'approve' || action === 'reject') {
      if (!manager && !isSupervisor) {
        return NextResponse.json({ error: 'forbidden', message: 'فقط المسؤول المباشر أو الإدارة/الموارد البشرية يمكنها البت في الطلبات' }, { status: 403 })
      }
      if (isOwner && !manager) {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكن البت في طلبك الخاص — يُحوَّل تلقائياً لمسؤولك المباشر' }, { status: 403 })
      }
      if (request.status !== 'pending') {
        return NextResponse.json({ error: 'invalid_state', message: 'تم البت في هذا الطلب مسبقاً' }, { status: 400 })
      }
      if (action === 'reject' && !note) {
        return NextResponse.json({ error: 'missing_fields', message: 'سبب الرفض إلزامي' }, { status: 400 })
      }

      // الموافقة على السنوية: إعادة فحص الرصيد ثم الخصم داخل معاملة واحدة
      if (action === 'approve' && request.type === 'annual') {
        var policy = await getPolicy()
        var balance = await getOrCreateBalance(request.employeeId, policy.defaultAnnualDays)
        var remaining = balance.annualTotal + balance.carriedOver - balance.used
        if (request.days > remaining) {
          return NextResponse.json({
            error: 'insufficient_balance',
            message: 'لا يمكن الاعتماد — رصيد الموظف غير كافٍ (المتبقي ' + remaining + ' والمطلوب ' + request.days + ')',
          }, { status: 400 })
        }
        await db.$transaction([
          db.leaveRequest.update({
            where: { id },
            data: { status: 'approved', reviewedById: me.id, reviewedAt: new Date(), reviewNote: note },
          }),
          db.leaveBalance.update({
            where: { userId: request.employeeId },
            data: { used: { increment: request.days } },
          }),
        ])
      } else {
        await db.leaveRequest.update({
          where: { id },
          data: { status: action === 'approve' ? 'approved' : 'rejected', reviewedById: me.id, reviewedAt: new Date(), reviewNote: note },
        })
      }

      // إشعار الموظف بالقرار + نسخة للإدارة/الموارد البشرية
      try {
        if (action === 'approve') {
          await db.notification.create({
            data: {
              userId: request.employeeId,
              type: 'leave_approved',
              title: 'تم اعتماد طلب إجازتك',
              message: periodMsg + ' — اعتُمد من ' + me.name + (note ? ' ملاحظة: ' + note : '') + '، تم خصم الأيام من رصيدك',
              severity: 'info',
              link: 'profile',
              entityType: 'leave_request',
              entityId: request.id,
            },
          })
        } else {
          await db.notification.create({
            data: {
              userId: request.employeeId,
              type: 'leave_rejected',
              title: 'تم رفض طلب إجازتك',
              message: periodMsg + ' — السبب: ' + (note || '—'),
              severity: 'warning',
              link: 'profile',
              entityType: 'leave_request',
              entityId: request.id,
            },
          })
        }
        await notifyUsers({
          type: 'leave_decision',
          title: action === 'approve' ? 'اعتماد إجازة' : 'رفض إجازة',
          message: request.employee.name + ' — ' + periodMsg + ' — بواسطة ' + me.name,
          severity: 'info',
          link: 'profile',
          entityType: 'leave_request',
          entityId: request.id,
          permissions: [],
          roles: ['top_management'],
          includeSystemAdmin: true,
          excludeUserIds: [me.id, request.employeeId],
        })
      } catch (notifyErr) {
        console.warn('v68 leave decision notifications skipped:', notifyErr)
      }

      return NextResponse.json({ ok: true, status: action === 'approve' ? 'approved' : 'rejected' })
    }

    // ── الإلغاء ──
    if (action === 'cancel') {
      if (request.status === 'pending') {
        if (!isOwner && !manager && !isSupervisor) {
          return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية إلغاء هذا الطلب' }, { status: 403 })
        }
      } else if (request.status === 'approved') {
        // إلغاء إجازة معتمدة — للإدارة/الموارد البشرية فقط مع إرجاع الرصيد السنوي
        if (!manager) {
          return NextResponse.json({ error: 'forbidden', message: 'إلغاء إجازة معتمدة متاح للإدارة/الموارد البشرية فقط' }, { status: 403 })
        }
      } else {
        return NextResponse.json({ error: 'invalid_state', message: 'لا يمكن إلغاء طلب مرفوض' }, { status: 400 })
      }

      if (request.status === 'approved' && request.type === 'annual') {
        // v72: معاملة تفاعلية — إرجاع الرصيد مع منع النزول تحت الصفر
        // (تعديل إداري لاحق قد يكون صفّر used، والخصم الأعمى كان يجعله سالباً = رصيد زائف)
        var cancelEmpId = request.employeeId
        var cancelDays = request.days
        var deciderId = me.id
        await db.$transaction(async function(tx) {
          await tx.leaveRequest.update({
            where: { id },
            data: { status: 'cancelled', reviewedById: deciderId, reviewedAt: new Date(), reviewNote: note },
          })
          var bal = await tx.leaveBalance.findUnique({ where: { userId: cancelEmpId } })
          if (bal) {
            var restored = Math.max(0, bal.used - cancelDays)
            if (restored !== bal.used) {
              await tx.leaveBalance.update({ where: { userId: cancelEmpId }, data: { used: restored } })
            }
          }
        })
      } else {
        await db.leaveRequest.update({
          where: { id },
          data: { status: 'cancelled', reviewedById: me.id, reviewedAt: new Date(), reviewNote: note },
        })
      }

      try {
        if (!isOwner) {
          await db.notification.create({
            data: {
              userId: request.employeeId,
              type: 'leave_cancelled',
              title: 'تم إلغاء طلب إجازة',
              message: periodMsg + ' — أُلغي بواسطة ' + me.name + (note ? ' السبب: ' + note : ''),
              severity: 'warning',
              link: 'profile',
              entityType: 'leave_request',
              entityId: request.id,
            },
          })
        }
        if (isOwner || !manager) {
          await notifyUsers({
            type: 'leave_decision',
            title: 'إلغاء إجازة',
            message: request.employee.name + ' — ' + periodMsg + ' — بواسطة ' + me.name,
            severity: 'info',
            link: 'profile',
            entityType: 'leave_request',
            entityId: request.id,
            permissions: [],
            roles: ['top_management'],
            includeSystemAdmin: true,
            excludeUserIds: [me.id, request.employeeId],
          })
        }
      } catch (notifyErr) {
        console.warn('v68 leave cancel notifications skipped:', notifyErr)
      }

      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    return NextResponse.json({ error: 'invalid_value', message: 'إجراء غير معروف' }, { status: 400 })
  } catch (error) {
    return handleDbError(error, 'البت في طلب الإجازة')
  }
}
