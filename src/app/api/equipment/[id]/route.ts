import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'
import { canWrite, hasPermission } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    // SECURITY FIX: تفاصيل المعدة تتضمن سجل الصيانة وتكاليفه — بوابة قراءة
    if (!hasPermission(user.role, 'equipment', user.permissions, user.email)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض المعدات' }, { status: 403 })
    }
    const { id } = await params
    const result = await safeDbOp(
      () => db.equipment.findUnique({
        where: { id },
        include: { project: true, maintenance: { include: { performedBy: { select: { name: true, nameEn: true } } }, orderBy: { date: 'desc' }, take: 10 } },
      }),
      'جلب المعدة'
    )
    if (!result.success) return result.response
    if (!result.data) return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    return NextResponse.json({ equipment: result.data })
  } catch (error) {
    return handleDbError(error, 'جلب المعدة')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل المعدات' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json()
    // v42: السماح بإسناد المعدة لمشروع (استعادة المعدات اليتيمة بعد حذف مشاريعها)
    var v42OldProjectId: string | null = null
    try {
      var v42OldEq = await db.equipment.findUnique({ where: { id }, select: { projectId: true } })
      v42OldProjectId = v42OldEq ? v42OldEq.projectId : null
    } catch { v42OldProjectId = null }
    var v42ProjectData: Record<string, any> = {}
    if (body.projectId !== undefined) {
      var v42Req = String(body.projectId || '').trim()
      if (v42Req === '') {
        v42ProjectData.projectId = null
      } else {
        var v42Proj = await db.project.findUnique({ where: { id: v42Req }, select: { id: true } })
        if (!v42Proj) {
          return NextResponse.json({ error: 'invalid_project', message: 'المشروع المحدد غير موجود' }, { status: 400 })
        }
        v42ProjectData.projectId = v42Req
      }
    }
    // SECURITY FIX: قائمة سماح لحالة المعدة — كانت تقبل أي نص يكتب في بطاقة المعدة
    var VALID_EQUIP_STATUS = ['operational', 'stopped', 'maintenance_needed']
    var safeStatus = VALID_EQUIP_STATUS.includes(String(body.status)) ? String(body.status) : undefined
    const result = await safeDbOp(
      () => db.equipment.update({
        where: { id },
        data: {
          name: body.name, number: body.number, type: body.type,
          status: safeStatus,
          dailyHours: Math.max(0, parseFloat(body.dailyHours) || 0),
          lastMaintenance: body.lastMaintenance ? new Date(body.lastMaintenance) : null,
          nextMaintenance: body.nextMaintenance ? new Date(body.nextMaintenance) : null,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          ...v42ProjectData,
        },
      }),
      'تحديث المعدة'
    )
    if (!result.success) return result.response
    // v42: توثيق إعادة إسناد المعدة لمشروع آخر (استعادة اليتيمة)
    if (v42ProjectData.projectId !== undefined && v42ProjectData.projectId !== v42OldProjectId) {
      var v42Details = v42ProjectData.projectId
        ? 'إسناد المعدة إلى مشروع (استعادة معدات v42)'
        : 'إزالة إسناد المعدة من المشروع (أصبحت بدون مشروع)'
      safeDbOp(
        () => db.auditLog.create({
          data: { userId: user.id, projectId: v42ProjectData.projectId, action: 'update', entity: 'equipment', entityId: id, details: v42Details },
        }),
        'سجل التدقيق'
      ).catch(function() {})
    }
    return NextResponse.json({ equipment: result.data })
  } catch (error) {
    return handleDbError(error, 'تحديث المعدة')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف المعدات' }, { status: 403 })
    }
    const { id } = await params
    const result = await safeDbOp(() => db.equipment.delete({ where: { id } }), 'حذف المعدة')
    if (!result.success) return result.response
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleDbError(error, 'حذف المعدة')
  }
}

