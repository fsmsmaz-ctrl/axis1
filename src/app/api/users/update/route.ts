import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { buildAuditDetails, handleDbError, safeDbOp } from '@/lib/api-helpers'
import { checkRateLimit, RateLimitPresets } from '@/lib/rate-limit'
import { VALID_ROLES, normalizeRole, SYSTEM_ADMIN_EMAIL, canManageUsers, canAssignRoleTo, canManageTargetAccount, HR_MANAGE_PERMISSION_KEY } from '@/lib/auth'

// FIX-3.2: Removed hardcoded ADMIN_EMAIL — now uses role-based check

var ALL_PERMISSIONS = [
  'projects', 'drive_lines', 'daily_reports', 'safety', 'equipment', 'costs', 'finishings', 'tasks', 'performance',
  // v91: «التقارير» صلاحية قسم قابلة للمنح من إدارة المستخدمين (مطابقة لـ MODULE_PERMISSIONS)
  'reports', 'notifications', 'oversight',
  'rpt_daily_site', 'rpt_production', 'rpt_safety', 'rpt_attendance',
  'rpt_revenue', 'rpt_costs', 'rpt_profit', 'rpt_equipment',
  'rpt_weekly', 'rpt_monthly', 'rpt_handover',
]

export async function PATCH(req: NextRequest) {
  var rl = checkRateLimit(req, RateLimitPresets.write)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'too_many_requests', message: 'طلبات كثيرة جداً، يرجى الانتظار' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  try {
    var authUser = await getAuthUser(req)
    // FIX-3.2: Use role check instead of hardcoded email
    // v67: مدير النظام (العلم أو البريد) يدير المستخدمين أيضاً — لم يعد مقيّداً بدوره
    var editorIsSysAdmin = authUser != null &&
      (authUser.isSystemAdmin === true || (authUser.email || '').toLowerCase().trim() === SYSTEM_ADMIN_EMAIL)
    // v87 (قرار صاحب الموقع): تعديل الحسابات للإدارة كافة والمدير المالي والإداري
    // («المحاسب» سابقاً) — كانت للإدارة العليا فقط. صمامات v92 أدناه تفصل الأدوار.
    if (!authUser || !canManageUsers(authUser)) {
      return NextResponse.json({ error: 'forbidden', message: 'هذه العملية متاحة للإدارة فقط' }, { status: 403 })
    }

    var body = await req.json()
    var userId = body.userId
    var name = body.name
    var nameEn = body.nameEn
    // v63: تطبيع الدور قبل التحقق والحفظ
    var role = body.role !== undefined ? normalizeRole(body.role) : undefined
    var phone = body.phone
    var password = body.password
    var permissions = body.permissions

    if (!userId) {
      return NextResponse.json({ error: 'missing_fields', message: 'معرف المستخدم مطلوب' }, { status: 400 })
    }

    var targetResult = await safeDbOp(
      () => db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, permissions: true } }),
      'البحث عن المستخدم'
    )
    if (!targetResult.success) return targetResult.response
    if (!targetResult.data) {
      return NextResponse.json({ error: 'not_found', message: 'المستخدم غير موجود' }, { status: 404 })
    }

    // FIX-3.2: Protect top_management accounts from modification by role, not email
    // v63: المقارنة عبر normalizeRole — حماية الحسابات الإدارية حتى لو كان نص
    // الدور في القاعدة يحمل مسافة/حرفاً كبيراً من تعديل يدوي قديم
    // v67 FIX: استثناء مدير النظام — كان هذا الفحص يمنعه من إغلاق صلاحية عن
    // أحد الإداريين (403 صامت) فتبدو الصلاحية مغلقة والقسم يظل ظاهراً لصاحبه
    //
    // v92 (تدقيق أمني) — استُبدل الفحص القديم بتراتب إدارة المستخدمين:
    //   1) حماية الأهداف: كان الإدارة العليا فقط محمية، فبقي المدير المالي
    //      والإداري يستطيع إعادة تعيين كلمة مرور مدير مشروع قائم ثم الدخول
    //      بحسابه (ترقية صلاحيات كاملة). الآن canManageTargetAccount تحمي كل
    //      حساب أعلى رتبة من المحرر (المدير المالي: الإدارة العليا + مديرو
    //      المشاريع — مدير المشروع: الإدارة العليا كما كان). مدير النظام يتجاوز.
    //   2) التعديل الذاتي: كان أي مدير يستطيع تغيير دوره بنفسه إلى «مدير
    //      مشروع» (فيفتح الأسعار السرية التي لا تفتحها الصلاحيات المخصصة
    //      أصلاً) أو منح نفسه أي صلاحيات أو تغيير كلمة مروره من إدارة
    //      المستخدمين متجاوزاً تحقق كلمة المرور الحالية في الملف الشخصي.
    //      الآن: التعديل الذاتي للحقول الآمنة (الاسم/الهاتف) متاح، وأي
    //      محاولة لتغيير الدور أو الصلاحيات أو كلمة المرور للذات تُرفض —
    //      كلمة المرور من الملف الشخصي، والدور والصلاحيات للإدارة الأعلى.
    var isSelfEdit = targetResult.data.id === authUser.id
    if (!editorIsSysAdmin && !isSelfEdit && !canManageTargetAccount(authUser, targetResult.data.role)) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل حسابات هذه الرتبة — إدارتها لمدير النظام والإدارة الأعلى' }, { status: 403 })
    }
    if (isSelfEdit && !editorIsSysAdmin && (role !== undefined || permissions !== undefined || (password && password.trim()))) {
      return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك تعديل دورك أو صلاحياتك أو كلمة مرورك من إدارة المستخدمين — كلمة المرور من الملف الشخصي، ودورك وصلاحياتك تديرها الإدارة' }, { status: 403 })
    }

    var updateData: Record<string, any> = {}

    if (name !== undefined && name.trim()) updateData.name = name.trim()
    if (nameEn !== undefined && nameEn.trim()) updateData.nameEn = nameEn.trim()
    if (phone !== undefined) updateData.phone = phone.trim() || null
    if (role !== undefined) {
      if (!(VALID_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json({ error: 'invalid_value', message: 'دور غير صالح. الأدوار المسموحة: ' + (VALID_ROLES as readonly string[]).join(', ') }, { status: 400 })
      }
      // v87: منع ترقية الصلاحيات — منح دور «إدارة عليا» لمدير النظام
      // والإدارة العليا فقط.
      // v92 (تدقيق أمني): التراتب كامل — المحرر لا يمنح دوراً أعلى من رتبته
      // (كان المدير المالي والإداري يستطيع تحويل أي حساب إلى «مدير مشروع»).
      if (!canAssignRoleTo(authUser, role)) {
        return NextResponse.json({ error: 'forbidden', message: 'لا يمكنك منح هذا الدور — الأدوار المتاحة لك محدودة برتبتك' }, { status: 403 })
      }
      updateData.role = role
    }

    if (permissions !== undefined) {
      var cleanPerms: Record<string, boolean> = {}
      if (permissions && typeof permissions === 'object') {
        // v67: صلاحية تعديل بيانات الموظفين ('hr_manage') يمنحها ويسحبها
        // مدير النظام فقط من إدارة المستخدمين — تُتجاهل من غيره
        var allowKeys = editorIsSysAdmin ? ALL_PERMISSIONS.concat(['hr_manage']) : ALL_PERMISSIONS
        for (var i = 0; i < allowKeys.length; i++) {
          var key = allowKeys[i]
          if (typeof permissions[key] === 'boolean') {
            cleanPerms[key] = permissions[key]
          }
        }
      }
      // v93 (تدقيق أمني): منع «المسح الجانبي» لصلاحية الموارد البشرية —
      // نموذج إدارة المستخدمين يرسل خريطة الصلاحيات كاملة مع كل حفظ، والخادم
      // كان يستبدل الخريطة المخزنة بأخرى مبنيّة من مفاتيح المحرر المسموحة فقط،
      // فكانت صلاحية hr_manage القائمة (التي منحها مدير النظام) تُسقط صامتاً
      // عند أي تعديل عادي (اسم/هاتف) من مدير مشروع أو المدير المالي والإداري.
      // الآن: قيمة hr_manage المخزنة تُحفظ كما هي لغير مدير النظام — منحها
      // وسحبها يبقى لمدير النظام حصراً (allowKeys أعلاه)، ونجاة القيمة القائمة
      // من عمليات الاستبدال الجانبية.
      if (!editorIsSysAdmin) {
        var storedPerms = (targetResult.data as { permissions?: unknown }).permissions
        if (storedPerms && typeof storedPerms === 'object' && !Array.isArray(storedPerms) && typeof (storedPerms as Record<string, unknown>)[HR_MANAGE_PERMISSION_KEY] === 'boolean') {
          cleanPerms[HR_MANAGE_PERMISSION_KEY] = (storedPerms as Record<string, boolean>)[HR_MANAGE_PERMISSION_KEY]
        }
      }
      updateData.permissions = Object.keys(cleanPerms).length > 0 ? cleanPerms : null
    }

    if (password && password.trim()) {
      if (password.trim().length < 6) {
        return NextResponse.json({ error: 'invalid_value', message: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' }, { status: 400 })
      }
      updateData.password = await bcrypt.hash(password.trim(), 12)
      // SECURITY: رفع إصدار الجلسة يبطل فوراً كل التوكنات القديمة للمستخدم
      // (جلسة مهاجم سرق التوكن تنقطع لحظة تغيير كلمة المرور)
      updateData.tokenVersion = { increment: 1 }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'missing_fields', message: 'لم يتم تحديد أي حقل للتحديث' }, { status: 400 })
    }

    var updateResult = await safeDbOp(
      () => db.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true, email: true, name: true, nameEn: true,
          role: true, phone: true, active: true, permissions: true, createdAt: true,
        }
      }),
      'تحديث المستخدم'
    )
    if (!updateResult.success) return updateResult.response

    // SECURITY FIX: تعديل المستخدمين (دور/صلاحيات/كلمة مرور) لم يكن يُوثق إطلاقاً —
    // الآن يُسجل في سجل التدقيق (بدون أي بيانات كلمات مرور)
    var changedFields = Object.keys(updateData).filter(function(f) { return f !== 'password' && f !== 'tokenVersion' })
    // v22: توثيق دقيق لقيم الحقول المعدّلة — القيمة قبل ← القيمة الآن
    var userDiffOld: any = {}
    var userDiffNew: any = {}
    for (var uci = 0; uci < changedFields.length; uci++) {
      var uf = changedFields[uci]
      userDiffOld[uf] = (targetResult.data as any)[uf]
      userDiffNew[uf] = (updateData as any)[uf]
    }
    await safeDbOp(
      () => db.auditLog.create({
        data: {
          userId: authUser!.id,
          action: 'update',
          entity: 'user',
          entityId: userId,
          details: buildAuditDetails(userDiffOld, userDiffNew, 'تعديل مستخدم (' + targetResult.data.email + ')' + (updateData.password ? ' + إعادة تعيين كلمة المرور (أُبطلت الجلسات القديمة)' : ''), { skipFields: ['id', 'createdAt', 'updatedAt', 'cuid', 'permissions'] }),
        },
      }),
      'سجل التدقيق'
    )

    return NextResponse.json({
      message: 'تم تحديث المستخدم بنجاح',
      user: { ...updateResult.data, permissions: updateResult.data.permissions ?? {} }
    })
  } catch (error) {
    console.error('Update user error:', error)
    return handleDbError(error, 'تحديث المستخدم')
  }
}
