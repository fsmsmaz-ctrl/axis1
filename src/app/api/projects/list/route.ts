import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError, safeDbOp } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'unauthorized', message: 'يجب تسجيل الدخول' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const where: any = {}
  if (status && status !== 'all') {
    where.status = status
  }

  const result = await safeDbOp(
    () => db.project.findMany({
      where,
      include: {
        manager: { select: { name: true, nameEn: true } },
        engineer: { select: { name: true, nameEn: true } },
        _count: {
          select: { driveLines: true, dailyReports: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    'جلب قائمة المشاريع'
  )

  if (!result.success) return result.response
  return NextResponse.json({ projects: result.data })
}
