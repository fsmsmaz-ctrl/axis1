import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { SYSTEM_ADMIN_EMAIL } from '@/lib/auth'
import { db } from '@/lib/db'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { safeDbOp, handleDbError } from '@/lib/api-helpers'
import { notifyUsers } from '@/lib/notify'

// اعتماد أو رفض التشطيب المرفوع من المشرف
// الاعتماد/الرفض: الإداري (الإدارة العليا) أو مدير المشروع أو مدير النظام فقط
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  var user = await getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  var isSystemAdmin = (user.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL
  var isTopManagement = user.role === 'top_management'
  var isProjectManager = user.role === 'project_manager'
  if (!isSystemAdmin && !isTopManagement && !isProjectManager) {
    return NextResponse.json(
      { error: 'forbidden', message: 'اعتماد أو رفض التشطيبات متاح للإداري أو مدير المشروع أو مدير النظام فقط' },
      { status: 403 }
    )
  }

  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  var { id } = await params
  var action: 'approve' | 'reject' = 'approve'

  try {
    var body = await req.json().catch(function() { return {} })
    action = body.action === 'reject' ? 'reject' : 'approve'
    var reviewNotes = body.notes ? String(body.notes).trim() : ''

    // الرفض يشترط ذكر السبب — يعود التشطيب للمشرف ليعدل بناءً عليه
    if (action === 'reject' && !reviewNotes) {
      return NextResponse.json(
        { error: 'missing_notes', message: 'يرجى ذكر سبب الرفض ليتمكن المشرف من التعديل' },
        { status: 400 }
      )
    }

    var existingResult = await safeDbOp(
      () => db.finishing.findUnique({
        where: { id },
        select: {
          status: true, projectId: true, date: true, submittedById: true, signedById: true,
          project: { select: { name: true, code: true } },
        },
      }),
      'البحث عن التشطيب'
    )
    if (!existingResult.success) return existingResult.response
    var existing = existingResult.data

    if (!existing) {
      return NextResponse.json({ error: 'not_found', message: 'التشطيب غير موجود' }, { status: 404 })
    }

    if (existing.status !== 'submitted') {
      return NextResponse.json(
        { error: 'invalid_status', message: 'لا يمكن اعتماد أو رفض تشطيب لم يتم رفعه للإدارة' },
        { status: 400 }
      )
    }

    var newStatus = action === 'approve' ? 'approved' : 'rejected'

    var updateResult = await safeDbOp(
      () => db.finishing.update({
        where: { id },
        data: {
          status: newStatus,
          approvedById: user!.id,
          approvedAt: new Date(),
          // الاعتماد يمسح ملاحظات المراجعة السابقة — الرفض يحفظ السبب
          reviewNotes: action === 'reject' ? reviewNotes : null,
        },
      }),
      action === 'approve' ? 'اعتماد التشطيب' : 'رفض التشطيب'
    )
    if (!updateResult.success) return updateResult.response

    safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: user!.id, projectId: existing.projectId,
          action: action === 'approve' ? 'approve' : 'reject',
          entity: 'finishing', entityId: id,
          details: (action === 'approve' ? 'Approved finishing' : 'Rejected finishing') + (reviewNotes ? ' — ' + reviewNotes : ''),
        },
      }),
      'سجل التدقيق'
    ).catch(function() {})

    // ── تنبيه المشرف الرافع بنتيجة القرار ──
    // صف موجّه للرافع حصراً (لا يُنشأ إذا كان المعتمد هو الرافع نفسه)
    var recipientId = existing.submittedById || existing.signedById
    if (recipientId && recipientId !== user!.id) {
      db.notification.create({
        data: {
          userId: recipientId,
          projectId: existing.projectId,
          type: action === 'approve' ? 'finishing_approved' : 'finishing_rejected',
          title: action === 'approve' ? 'تم اعتماد التشطيب' : 'تم رفض التشطيب',
          message: action === 'approve'
            ? 'تم اعتماد التشطيب بتاريخ ' + new Date(existing.date).toISOString().split('T')[0] + ' — مشروع ' + (existing.project?.name || existing.project?.code || '') + ' بواسطة ' + user!.name + '.'
            : 'تم رفض التشطيب بتاريخ ' + new Date(existing.date).toISOString().split('T')[0] + ' — مشروع ' + (existing.project?.name || existing.project?.code || '') + ' بواسطة ' + user!.name + '. السبب: ' + reviewNotes + ' — يمكنك تعديله ورفعه مجدداً.',
          severity: action === 'approve' ? 'info' : 'warning',
          link: 'finishings',
          entityType: 'finishing',
          entityId: id + ':' + newStatus,
        },
      }).catch(function() {})
    }

    // ── إشعار عام لأصحاب الصلاحية بقرار نهائي (اختياري للشفافية) ──
    notifyUsers({
      type: action === 'approve' ? 'finishing_approved' : 'finishing_rejected',
      title: action === 'approve' ? 'تم اعتماد تشطيب' : 'تم رفض تشطيب',
      message: (action === 'approve' ? 'تم اعتماد' : 'تم رفض') + ' تشطيب بتاريخ ' + new Date(existing.date).toISOString().split('T')[0] + ' — مشروع ' + (existing.project?.name || existing.project?.code || '') + ' بواسطة ' + user!.name + '.',
      severity: action === 'approve' ? 'info' : 'warning',
      projectId: existing.projectId,
      link: 'finishings',
      entityType: 'finishing',
      entityId: id + ':' + newStatus + ':decision',
      permissions: ['finishings'],
      roles: ['top_management', 'project_manager'],
      includeSystemAdmin: true,
      excludeUserIds: [user!.id, recipientId].filter(Boolean) as string[],
    }).catch(function() {})

    return NextResponse.json({ finishing: updateResult.data, success: true })
  } catch (error) {
    return handleDbError(error, action === 'reject' ? 'رفض التشطيب' : 'اعتماد التشطيب')
  }
}

