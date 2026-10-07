import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { getAuthUser } from '@/lib/auth-server'
import { ensureMediaSupport, ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp, validImageDataUrl, logEquipmentChange } from '@/lib/api-helpers'
import { canWrite, hasPermission, isSystemAdminAccount } from '@/lib/auth'

// ─── v75: تسميات ثنائية اللغة لتغييرات المعدة في المفكرة ──────────────
var EQ_FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  name: { ar: 'الاسم', en: 'Name' },
  number: { ar: 'الرقم', en: 'Number' },
  type: { ar: 'النوع', en: 'Type' },
  status: { ar: 'الحالة', en: 'Status' },
  dailyHours: { ar: 'ساعات العمل اليومية', en: 'Daily hours' },
  lastMaintenance: { ar: 'آخر صيانة', en: 'Last maintenance' },
  nextMaintenance: { ar: 'الصيانة القادمة', en: 'Next maintenance' },
  notes: { ar: 'الملاحظات', en: 'Notes' },
  projectId: { ar: 'المشروع', en: 'Project' },
  image: { ar: 'الصورة', en: 'Image' },
}
var EQ_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  operational: { ar: 'تعمل', en: 'Operational' },
  stopped: { ar: 'متوقفة', en: 'Stopped' },
  maintenance_needed: { ar: 'تحتاج صيانة', en: 'Maintenance Needed' },
}
var EQ_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  jacking_machine: { ar: 'ماكينة Jacking', en: 'Jacking Machine' },
  crane: { ar: 'رافعة', en: 'Crane' },
  excavator: { ar: 'حفار', en: 'Excavator' },
  pump: { ar: 'مضخة', en: 'Pump' },
  other: { ar: 'أخرى', en: 'Other' },
}

function eqDisplayValue(field: string, v: any): { ar: string; en: string } {
  if (v === null || v === undefined || v === '') return { ar: '—', en: '—' }
  if (field === 'status') { var s = EQ_STATUS_LABELS[String(v)]; if (s) return s }
  if (field === 'type') { var t = EQ_TYPE_LABELS[String(v)]; if (t) return t }
  if (field === 'lastMaintenance' || field === 'nextMaintenance') {
    var d = new Date(v)
    if (!isNaN(d.getTime())) return { ar: d.toISOString().split('T')[0], en: d.toISOString().split('T')[0] }
  }
  return { ar: String(v), en: String(v) }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureEquipmentLogSupport()
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
    // v75: الحذف الناعم — تفاصيل المعدة المحذوفة لمدير النظام فقط (تختفي عن غيره كأنها غير موجودة)
    if ((result.data as any).deletedAt && !isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    }
    return NextResponse.json({ equipment: result.data })
  } catch (error) {
    return handleDbError(error, 'جلب المعدة')
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لتعديل المعدات' }, { status: 403 })
    }
    const { id } = await params
    const body = await req.json()
    // v75: جلب السجل القديم كاملاً — للحذف الناعم (حارس الظهور) ولمفكرة التغييرات (قبل ← الآن)
    var v75Old: any = null
    try {
      v75Old = await db.equipment.findUnique({ where: { id } })
    } catch { v75Old = null }
    if (!v75Old) return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    // v75: المعدة المحذوفة مخفية عن غير مدير النظام حتى التعديل
    if (v75Old.deletedAt && !isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    }
    // v42: السماح بإسناد المعدة لمشروع (استعادة المعدات اليتيمة بعد حذف مشاريعها)
    var v42OldProjectId: string | null = v75Old.projectId || null
    var v42ProjectData: Record<string, any> = {}
    var v75NewProjectName: string | null = null
    if (body.projectId !== undefined) {
      var v42Req = String(body.projectId || '').trim()
      if (v42Req === '') {
        v42ProjectData.projectId = null
      } else {
        var v42Proj = await db.project.findUnique({ where: { id: v42Req }, select: { id: true, name: true } })
        if (!v42Proj) {
          return NextResponse.json({ error: 'invalid_project', message: 'المشروع المحدد غير موجود' }, { status: 400 })
        }
        v42ProjectData.projectId = v42Req
        v75NewProjectName = v42Proj.name
      }
    }
    // SECURITY FIX: قائمة سماح لحالة المعدة — كانت تقبل أي نص يكتب في بطاقة المعدة
    var VALID_EQUIP_STATUS = ['operational', 'stopped', 'maintenance_needed']
    var safeStatus = VALID_EQUIP_STATUS.includes(String(body.status)) ? String(body.status) : undefined
    // v74: إصلاح مسح الصورة الصامت — كانت الصورة تُصفَّر (null) حتى عندما يكون مفتاح
    // image غائباً عن الطلب كلياً؛ الآن تُلمس فقط إذا أُرسل المفتاح فعلاً
    var v74ImageData: Record<string, any> = {}
    if ('image' in body) v74ImageData.image = validImageDataUrl(body.image)

    // v75: بناء فرق التغييرات ثنائي اللغة (يُسجل في المفكرة وسجل التدقيق بالتوقيت)
    var v75ChangesAr: string[] = []
    var v75ChangesEn: string[] = []
    function v75Push(field: string, oldV: any, newV: any) {
      var lbl = EQ_FIELD_LABELS[field] || { ar: field, en: field }
      var o = eqDisplayValue(field, oldV)
      var n = eqDisplayValue(field, newV)
      v75ChangesAr.push(lbl.ar + ': من «' + o.ar + '» إلى «' + n.ar + '»')
      v75ChangesEn.push(lbl.en + ': from "' + o.en + '" to "' + n.en + '"')
    }
    if (body.name !== undefined && String(body.name).trim() !== String(v75Old.name)) v75Push('name', v75Old.name, String(body.name).trim())
    if (body.number !== undefined && String(body.number).trim() !== String(v75Old.number)) v75Push('number', v75Old.number, String(body.number).trim())
    if (body.type !== undefined && String(body.type) !== String(v75Old.type)) v75Push('type', v75Old.type, body.type)
    if (safeStatus !== undefined && safeStatus !== String(v75Old.status)) v75Push('status', v75Old.status, safeStatus)
    if (body.dailyHours !== undefined) {
      var v75NewHours = Math.max(0, parseFloat(body.dailyHours) || 0)
      if (Math.abs(v75NewHours - Number(v75Old.dailyHours || 0)) > 0.001) v75Push('dailyHours', v75Old.dailyHours, v75NewHours)
    }
    if (body.lastMaintenance !== undefined) {
      var v75NewLast = body.lastMaintenance ? new Date(body.lastMaintenance).toISOString().split('T')[0] : null
      var v75OldLast = v75Old.lastMaintenance ? new Date(v75Old.lastMaintenance).toISOString().split('T')[0] : null
      if (v75NewLast !== v75OldLast) v75Push('lastMaintenance', v75OldLast, v75NewLast)
    }
    if (body.nextMaintenance !== undefined) {
      var v75NewNext = body.nextMaintenance ? new Date(body.nextMaintenance).toISOString().split('T')[0] : null
      var v75OldNext = v75Old.nextMaintenance ? new Date(v75Old.nextMaintenance).toISOString().split('T')[0] : null
      if (v75NewNext !== v75OldNext) v75Push('nextMaintenance', v75OldNext, v75NewNext)
    }
    if (body.notes !== undefined) {
      var v75NewNotes = body.notes ? String(body.notes).slice(0, 2000) : null
      if ((v75NewNotes || '') !== (v75Old.notes || '')) v75Push('notes', v75Old.notes, v75NewNotes)
    }
    if ('image' in body) {
      var v75HasOldImg = !!v75Old.image
      if (!body.image || !validImageDataUrl(body.image)) {
        if (v75HasOldImg) {
          v75ChangesAr.push('الصورة: أُزيلت')
          v75ChangesEn.push('Image: removed')
        }
      } else if (String(body.image) !== String(v75Old.image || '')) {
        v75ChangesAr.push(v75HasOldImg ? 'الصورة: تم تحديث الصورة' : 'الصورة: أُضيفت صورة للمعدة')
        v75ChangesEn.push(v75HasOldImg ? 'Image: photo updated' : 'Image: photo added')
      }
    }
    if (v42ProjectData.projectId !== undefined && v42ProjectData.projectId !== v42OldProjectId) {
      var v75OldProjName: string | null = null
      if (v42OldProjectId) {
        try {
          var v75OldProj = await db.project.findUnique({ where: { id: v42OldProjectId }, select: { name: true } })
          v75OldProjName = v75OldProj ? v75OldProj.name : null
        } catch { v75OldProjName = null }
      }
      v75Push('projectId', v75OldProjName, v75NewProjectName)
    }

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
          ...v74ImageData,
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
    // v75: تسجيل التعديل في مفكرة المعدات + سجل التدقيق — بالتوقيت واسم المستخدم
    if (v75ChangesAr.length > 0) {
      var v75Name = body.name !== undefined && String(body.name).trim() ? String(body.name).trim() : String(v75Old.name)
      await logEquipmentChange({
        equipmentId: id, equipmentName: v75Name, user,
        action: 'update',
        changesAr: 'عدّل بيانات المعدة «' + v75Name + '» — ' + v75ChangesAr.join('؛ '),
        changesEn: 'Updated equipment "' + v75Name + '" — ' + v75ChangesEn.join('; '),
        projectId: (result.data as any).projectId || null,
      })
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
    var rl = checkRateLimit(req, RateLimitPresets.write)
    if (rl.limited) {
      return NextResponse.json({ error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار قليلاً' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
    }
    if (!canWrite(user.role, 'equipment', user.permissions)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية لحذف المعدات' }, { status: 403 })
    }
    const { id } = await params
    // v70: فحص الوجود — حذف غير موجود كان يُسقط 500 «قاعدة البيانات غير مهيأة» مضللاً
    const delTarget = await safeDbOp(() => db.equipment.findUnique({ where: { id } }), 'فحص المعدة')
    if (!delTarget.success) return delTarget.response
    if (!delTarget.data) return NextResponse.json({ error: 'not_found', message: 'المعدة غير موجودة' }, { status: 404 })
    // v75: حذف ناعم — لا يُحذف شيء نهائياً أبداً؛ المحذوفة تختفي عن المستخدمين
    // وتبقى في أرشيف مرئي لمدير النظام فقط (مع سجل التدقيق بالتوقيت)
    var v75Old = delTarget.data as any
    if (v75Old.deletedAt) {
      return NextResponse.json({ error: 'already_deleted', message: 'المعدة محذوفة بالفعل (في أرشيف مدير النظام)' }, { status: 400 })
    }
    const result = await safeDbOp(
      () => db.equipment.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id },
      }),
      'حذف المعدة'
    )
    if (!result.success) return result.response
    await logEquipmentChange({
      equipmentId: id, equipmentName: v75Old.name, user,
      action: 'delete',
      changesAr: 'حذف المعدة «' + v75Old.name + '» (الرقم ' + v75Old.number + ') — اختفت عن المستخدمين وبقيت في أرشيف النظام (مرئية لمدير النظام فقط)',
      changesEn: 'Deleted equipment "' + v75Old.name + '" (No. ' + v75Old.number + ') — hidden from users, kept in system archive (visible to system admin only)',
      projectId: v75Old.projectId || null,
    })
    return NextResponse.json({ success: true, softDeleted: true })
  } catch (error) {
    return handleDbError(error, 'حذف المعدة')
  }
}
