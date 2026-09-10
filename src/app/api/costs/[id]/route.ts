import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, validateRequired, parseNumber, safeDbOp } from '@/lib/api-helpers'
import { canWrite } from '@/lib/auth'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: تعديل التكاليف للإدارة والمحاسب فقط
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'تعديل التكاليف متاح للإدارة والمحاسب فقط' }, { status: 403 })
  }

  try {
    const { id } = await params
    const body = await req.json()

    const validationError = validateRequired(body, ['date', 'category', 'description', 'amount'])
    if (validationError) return validationError

    const updateResult = await safeDbOp(
      () => db.cost.update({
        where: { id },
        data: {
          date: new Date(body.date),
          category: String(body.category),
          description: String(body.description),
          amount: parseNumber(body.amount, 0),
          notes: body.notes ? String(body.notes) : null,
          projectId: body.projectId ? String(body.projectId) : undefined,
        },
      }),
      'تحديث التكلفة'
    )
    if (!updateResult.success) return updateResult.response

    return NextResponse.json({ cost: updateResult.data, success: true })
  } catch (error: any) {
    return handleDbError(error, 'تحديث التكلفة')
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  // v13.1 SECURITY: حذف التكاليف للإدارة والمحاسب فقط
  if (!canWrite(user.role, 'costs', user.permissions)) {
    return NextResponse.json({ error: 'forbidden', message: 'حذف التكاليف متاح للإدارة والمحاسب فقط' }, { status: 403 })
  }

  try {
    const { id } = await params

    const deleteResult = await safeDbOp(
      () => db.cost.delete({ where: { id } }),
      'حذف التكلفة'
    )
    if (!deleteResult.success) return deleteResult.response

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return handleDbError(error, 'حذف التكلفة')
  }
}


