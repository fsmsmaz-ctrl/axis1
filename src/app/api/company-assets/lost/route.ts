// v42: تقرير الأصول المفقودة القابلة للاستعادة
// قبل v42 كان حذف المشروع يمسح أصوله (ملك/مستأجر/معار) نهائياً من قاعدة البيانات (CASCADE).
// سجل التدقيق نجا من الحذف (قيد SetNull) — يحتوي سجلات إنشاء وتعديل الأصول،
// وهذا المسار يستخرج منها قائمة بالأصول المفقودة لإعادة إنشائها بضغطة واحدة من صفحة المعدات.
// v43: كل أصل مستعاد يعود بنفس تاريخ تسجيله الأصلي واسم منشئه الأصلي (من سجل الإنشاء) —
// لا يُنسب أبداً لمن أجرى الاستعادة؛ بيانات المستعيد تُسجَّل في حقول منفصلة restoredBy/restoredAt.

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { safeDbOp } from '@/lib/api-helpers'

// استخراج اسم الأصل من تفاصيل السجل
function extractAssetName(details: string): string {
  if (!details) return ''
  var m = details.match(/^Added asset: (.+)$/)
  if (m) return m[1].trim()
  m = details.match(/تعديل أصل شركة: (.+)$/)
  if (m) return m[1].trim()
  try {
    var parsed = JSON.parse(details)
    if (parsed && parsed.summary) {
      var s = String(parsed.summary)
      var m2 = s.match(/تعديل أصل شركة: (.+)$/)
      return m2 ? m2[1].trim() : s
    }
  } catch {}
  return ''
}

// قيم valueLabels في api-helpers تُخزَّن عربياً في تفاصيل التغيير — نعيدها إلى قيم النظام
function normOwnership(v: string): string {
  var s = String(v || '').trim()
  if (s === 'ملك الشركة') return 'owned'
  if (s === 'مستأجر') return 'rented'
  if (s === 'معار') return 'borrowed'
  if (s === 'owned' || s === 'rented' || s === 'borrowed') return s
  return ''
}

function normStatus(v: string): string {
  var s = String(v || '').trim()
  var map: Record<string, string> = {
    'متاح': 'available', 'قيد الاستخدام': 'in_use', 'تم الإرجاع': 'returned', 'متلف': 'damaged',
  }
  return map[s] || s
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  // بوابة سجل التدقيق نفسها: الإدارة العليا ومدير المشاريع فقط
  if (user.role !== 'top_management' && user.role !== 'project_manager') {
    return NextResponse.json({ error: 'forbidden', message: 'لا تملك صلاحية عرض تقرير الاستعادة' }, { status: 403 })
  }

  var logsResult = await safeDbOp(
    () => db.auditLog.findMany({
      where: { entity: 'company_asset', action: { in: ['create', 'update'] } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
      include: { user: { select: { id: true, name: true } } },
    }),
    'جلب سجل تدقيق الأصول'
  )
  if (!logsResult.success) return logsResult.response

  var existingResult = await safeDbOp(
    () => db.companyAsset.findMany({ select: { id: true, name: true } }),
    'جلب الأصول الحالية'
  )
  if (!existingResult.success) return existingResult.response
  var existingIds = new Set<string>(existingResult.data.map(function(a: any) { return a.id }))

  var map: Record<string, any> = {}
  var logs = logsResult.data
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i]
    var entry = map[log.entityId]
    if (!entry) {
      entry = map[log.entityId] = {
        entityId: log.entityId, name: '', projectId: null as string | null,
        firstSeen: log.createdAt, lastSeen: log.createdAt,
        ownership: '', itemType: '', quantity: null as number | null,
        rentalCost: null as number | null, supplier: '', status: '',
        originalCreatedAt: null as Date | null, originalCreatedById: null as string | null,
        originalCreatedByName: null as string | null, creatorKnown: false, hasCreate: false,
        alreadyRestored: false, restoredAssetId: null as string | null,
      }
    }
    entry.lastSeen = log.createdAt
    if (log.projectId) entry.projectId = log.projectId
    // v43: التقاط تاريخ التسجيل الأصلي واسم المنشئ من أول سجل إنشاء — الاستعادة تحافظ عليهما
    if (log.action === 'create' && !entry.hasCreate) {
      entry.hasCreate = true
      entry.originalCreatedAt = log.createdAt
      if (log.user && log.user.id) { entry.originalCreatedById = log.user.id; entry.originalCreatedByName = log.user.name || null; entry.creatorKnown = true }
    }
    var nm = extractAssetName(log.details || '')
    if (nm && !entry.name) entry.name = nm
    try {
      var parsed = JSON.parse(log.details || 'null')
      if (parsed && Array.isArray(parsed.changes)) {
        for (var j = 0; j < parsed.changes.length; j++) {
          var ch = parsed.changes[j]
          var fe = String(ch.fieldEn || '')
          var nv = ch.new
          if (fe === 'Ownership') entry.ownership = normOwnership(String(nv)) || entry.ownership
          else if (fe === 'Item Type') entry.itemType = String(nv)
          else if (fe === 'Quantity') { var q = parseFloat(String(nv)); if (!isNaN(q)) entry.quantity = q }
          else if (fe === 'Rental Cost') { var rc = parseFloat(String(nv)); if (!isNaN(rc)) entry.rentalCost = rc }
          else if (fe === 'Supplier') entry.supplier = String(nv)
          else if (fe === 'Status' || fe === 'status') entry.status = normStatus(String(nv))
        }
      }
    } catch {}
  }

  // v43: فهرس الأصول الموجودة بالاسم — لتمييز ما استُعيد بالفعل (استعادة سابقة) في التقرير
  var existingByName = new Map<string, any>()
  for (var k = 0; k < existingResult.data.length; k++) {
    var ex = existingResult.data[k]
    if (ex && ex.name) existingByName.set(String(ex.name).trim().toLowerCase(), ex)
  }

  var lost: any[] = []
  for (var entityId in map) {
    var it = map[entityId]
    if (existingIds.has(entityId)) continue
    if (!it.originalCreatedAt) it.originalCreatedAt = it.firstSeen
    var nmKey = String(it.name || '').trim().toLowerCase()
    if (nmKey && existingByName.has(nmKey)) { it.alreadyRestored = true; it.restoredAssetId = existingByName.get(nmKey).id }
    if (!it.name) it.name = 'أصل غير مسمى'
    lost.push(it)
  }
  lost.sort(function(a: any, b: any) { return new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime() })
  return NextResponse.json({ lost: lost, count: lost.length })
}

