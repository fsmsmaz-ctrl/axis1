import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (user.role !== 'project_manager' && user.role !== 'top_management') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const action = body.action // 'approve' or 'reject'

  try {
    const report = await db.dailyReport.update({
      where: { id },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        approvedById: user.id,
        approvedAt: new Date(),
      },
    })

    await db.auditLog.create({
      data: {
        userId: user.id,
        dailyReportId: id,
        action: action === 'approve' ? 'approve' : 'reject',
        entity: 'daily_report',
        entityId: id,
        details: `${action === 'approve' ? 'Approved' : 'Rejected'} daily report`,
      },
    })

    return NextResponse.json({ report })
  } catch (error) {
    console.error('Approve report error:', error)
    return NextResponse.json({ error: 'Failed to update report status' }, { status: 500 })
  }
}
