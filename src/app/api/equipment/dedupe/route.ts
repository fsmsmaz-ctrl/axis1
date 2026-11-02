import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { ensureEquipmentLogSupport } from '@/lib/db-selfheal'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp, logEquipmentChange } from '@/lib/api-helpers'
import { isSystemAdminAccount } from '@/lib/auth'

// ─── v101: تنظيف المعدات المكررة الناتجة عن النقر المزدوج ───────────────
// الهدف: حذف المعدات التي أُنشئت بالخطأ كنتائج للنقر المتتالي على زر «إنشاء».
// المعيار الحازم للنسخة المكررة العرضية (جميعها يجب أن تتحقق معاً):
//   1) نفس الاسم (بعد تطبيع الحالة والفراغات) + نفس النوع.
//   2) نفس المنشئ (createdById) — أو كلاهما فارغ (معدات ما قبل v101).
//   3) أُنشئت خلال 60 ثانية من بعضها (نافذة النقر المزدوج).
//
// لكل مجموعة: نُبقي الأقدم (createdAt الأصغر) ونُقيّم الباقي:
//   • نحمي (لا نحذف) أي معدة فيها أي من:
//       - سجل صيانة (EquipmentMaintenance).
//       - صورة (image غير فارغة).
//       - ملاحظات (notes غير فارغة).
//       - قطع غيار (spareParts غير فارغة).
//       - أعطال (breakdowns غير فارغة).
//       - عُدِّلت فعلاً (updatedAt - createdAt > 5 ثوانٍ = جرى عليها تعديل حقيقي).
//   • ما عدا ذلك: حذف ناعم (deletedAt + deletedById) — قابل للاستعادة من الأرشيف.
//
// المسار للإدارة فقط. الوضع الافتراضي: تنفيذ (apply). أرسل ?dryRun=true للمعاينة فقط.
// كل حذف يُسجَّل في مفكرة المعدات (EquipmentLog) ليكون قابلاً للمراجعة والاستعادة.

export async function POST(req: NextRequest) {
  await ensureEquipmentLogSupport()
  try {
    const user = await getAuthUser(req)
    if (!user) return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
    if (!isSystemAdminAccount(user)) {
      return NextResponse.json({ error: 'forbidden', message: 'تنظيف المعدات المكررة متاح لمدير النظام فقط' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    const dryRun = searchParams.get('dryRun') === 'true' || searchParams.get('preview') === 'true'

    // 1) جلب كل المعدات غير المحذوفة مع عدّ سجلات الصيانة لكل واحدة
    var listResult = await safeDbOp(
      () => db.equipment.findMany({
        where: { deletedAt: null },
        select: {
          id: true, name: true, number: true, type: true,
          createdById: true, createdAt: true, updatedAt: true,
          image: true, notes: true, spareParts: true, breakdowns: true,
          projectId: true,
          _count: { select: { maintenance: true } },
        },
      }),
      'جلب المعدات للتنظيف'
    )
    if (!listResult.success) return listResult.response
    var all = listResult.data as any[]

    // 2) تجميع بمفتاح (name+type+createdById) — مع تطبيع الاسم
    function normName(s: string | null | undefined): string {
      return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
    }
    var groups: Record<string, any[]> = {}
    for (var i = 0; i < all.length; i++) {
      var e = all[i]
      var key = normName(e.name) + '|' + String(e.type || '') + '|' + String(e.createdById || '')
      if (!groups[key]) groups[key] = []
      groups[key].push(e)
    }

    // 3) داخل كل مجموعة: إيجاد العناقيد الزمنية (داخل 60 ثانية) ثم ترتيبها بالأقدم
    var WINDOW_MS = 60 * 1000
    var clusters: any[][] = []
    Object.keys(groups).forEach(function(k) {
      var members = groups[k]
      if (members.length < 2) return
      members.sort(function(a, b) { return a.createdAt.getTime() - b.createdAt.getTime() })
      // تجميع تتابعي: عضو جديد يُضاف للعنقود الحالي لو فرق وقته عن آخر عضو ≤ النافذة
      var current: any[] = [members[0]]
      for (var j = 1; j < members.length; j++) {
        var prev = current[current.length - 1]
        if (members[j].createdAt.getTime() - prev.createdAt.getTime() <= WINDOW_MS) {
          current.push(members[j])
        } else {
          if (current.length >= 2) clusters.push(current)
          current = [members[j]]
        }
      }
      if (current.length >= 2) clusters.push(current)
    })

    // 4) تقييم كل عضو في العنقود: هل هو نسخة عرضية قابلة للحذف أم محتوى مهم؟
    function isProtected(eq: any): { protected: boolean; reason?: string } {
      if ((eq._count && eq._count.maintenance > 0) || (!eq._count && eq.maintenance && eq.maintenance.length > 0)) {
        return { protected: true, reason: 'لديها سجلات صيانة' }
      }
      if (eq.image) return { protected: true, reason: 'لديها صورة' }
      if (eq.notes && String(eq.notes).trim()) return { protected: true, reason: 'لديها ملاحظات' }
      if (eq.spareParts && String(eq.spareParts).trim()) return { protected: true, reason: 'لديها قطع غيار' }
      if (eq.breakdowns && String(eq.breakdowns).trim()) return { protected: true, reason: 'لديها سجل أعطال' }
      // الحذف الناعم لا يغيّر updatedAt — لكن التعديل الفعلي نعم. لو الفرق > 5 ثوانٍ فهي معدّلة.
      var editedMs = eq.updatedAt.getTime() - eq.createdAt.getTime()
      if (editedMs > 5000) return { protected: true, reason: 'عُدِّلت بعد الإنشاء (محتوى حقيقي)' }
      return { protected: false }
    }

    var toDelete: any[] = []
    var skipped: any[] = []
    var groupsCleaned = 0
    clusters.forEach(function(cluster) {
      // الأقدم يُحفظ دائماً (keep) — هو الأصل
      var keep = cluster[0]
      var keepInfo = { id: keep.id, name: keep.name, number: keep.number, createdAt: keep.createdAt }
      var clusterDeleted: any[] = []
      var clusterSkipped: any[] = []
      for (var m = 1; m < cluster.length; m++) {
        var eq = cluster[m]
        var p = isProtected(eq)
        if (p.protected) {
          clusterSkipped.push({ id: eq.id, name: eq.name, number: eq.number, createdAt: eq.createdAt, reason: p.reason })
        } else {
          clusterDeleted.push({ id: eq.id, name: eq.name, number: eq.number, createdAt: eq.createdAt })
        }
      }
      // لا نحذف شيئاً إن كان كل الباقي محمياً (تفاديًا للحالات الغامضة) — لكن نسجّل التقرير
      if (clusterDeleted.length > 0) {
        groupsCleaned++
        clusterDeleted.forEach(function(d) {
          toDelete.push({ ...d, kept: keepInfo })
        })
      }
      clusterSkipped.forEach(function(s) {
        skipped.push({ ...s, kept: keepInfo })
      })
    })

    // 5) تنفيذ الحذف الناعم (إن لم يكن dryRun)
    var deleted: any[] = []
    var errors: any[] = []
    if (!dryRun) {
      for (var d = 0; d < toDelete.length; d++) {
        var item = toDelete[d]
        var delRes = await safeDbOp(
          () => db.equipment.update({
            where: { id: item.id },
            data: { deletedAt: new Date(), deletedById: user.id },
          }),
          'حذف مكررة'
        )
        if (delRes.success) {
          deleted.push({ id: item.id, name: item.name, number: item.number })
          await logEquipmentChange({
            equipmentId: item.id, equipmentName: item.name, user,
            action: 'delete',
            changesAr: 'حذف تلقائي كمعدة مكررة بالخطأ («' + item.name + '» / الرقم ' + item.number + ') — الأصل المحفوظ: «' + item.kept.name + '» (الرقم ' + item.kept.number + '). قابلة للاستعادة من الأرشيف',
            changesEn: 'Auto-deleted as accidental duplicate ("' + item.name + '" / No. ' + item.number + ') — kept original: "' + item.kept.name + '" (No. ' + item.kept.number + '). Restorable from archive',
            projectId: null,
          })
        } else {
          errors.push({ id: item.id, name: item.name, error: 'فشل الحذف' })
        }
      }
    }

    return NextResponse.json({
      mode: dryRun ? 'preview' : 'applied',
      scanned: all.length,
      duplicateClusters: clusters.length,
      groupsCleaned,
      candidatesForDeletion: toDelete.length,
      deleted: dryRun ? [] : deleted,
      deletedCount: dryRun ? 0 : deleted.length,
      skipped,
      skippedCount: skipped.length,
      errors,
      note: dryRun
        ? 'وضع المعاينة — لم يُحذف شيء. أرسل ?apply=true أو احذف dryRun لتنفيذ الحذف الناعم (قابل للاستعادة).'
        : 'تم الحذف الناعم للمعدات المكررة — يمكن استعادتها من أرشيف المحذوفات.',
    })
  } catch (error) {
    return handleDbError(error, 'تنظيف المعدات المكررة')
  }
}
