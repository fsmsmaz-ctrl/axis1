import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

// Get safety report for a daily report
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const safety = await db.safetyReport.findUnique({
    where: { dailyReportId: id },
  })

  return NextResponse.json({ safety })
}

// Create or update safety report for a daily report
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: dailyReportId } = await params
  const body = await req.json()

  // Get daily report to find projectId
  const dailyReport = await db.dailyReport.findUnique({
    where: { id: dailyReportId },
    select: { projectId: true, reportDate: true },
  })

  if (!dailyReport) {
    return NextResponse.json({ error: 'Daily report not found' }, { status: 404 })
  }

  try {
    const existing = await db.safetyReport.findUnique({
      where: { dailyReportId },
    })

    const data = {
      dailyReportId,
      projectId: dailyReport.projectId,
      reportDate: dailyReport.reportDate,
      ppeAvailable: !!body.ppeAvailable,
      helmetCheck: !!body.helmetCheck,
      bootsCheck: !!body.bootsCheck,
      glovesCheck: !!body.glovesCheck,
      glassesCheck: !!body.glassesCheck,
      workAreaCheck: !!body.workAreaCheck,
      barriersCheck: !!body.barriersCheck,
      shaftCheck: !!body.shaftCheck,
      ventilationCheck: !!body.ventilationCheck,
      electricalCheck: !!body.electricalCheck,
      craneCheck: !!body.craneCheck,
      hydraulicCheck: !!body.hydraulicCheck,
      fireExtinguishers: !!body.fireExtinguishers,
      workPermit: !!body.workPermit,
      toolboxTalk: !!body.toolboxTalk,
      hazards: body.hazards || '[]',
      observations: body.observations,
      violations: body.violations,
      incidentType: body.incidentType || 'none',
      incidentDescription: body.incidentDescription,
      signedBy: user.name,
      signedById: user.id,
      signedAt: new Date(),
    }

    let safety
    if (existing) {
      safety = await db.safetyReport.update({
        where: { dailyReportId },
        data,
      })
    } else {
      safety = await db.safetyReport.create({ data })
    }

    await db.auditLog.create({
      data: {
        userId: user.id,
        projectId: dailyReport.projectId,
        dailyReportId,
        action: existing ? 'update' : 'create',
        entity: 'safety_report',
        entityId: safety.id,
        details: 'Saved safety checklist',
      },
    })

    return NextResponse.json({ safety })
  } catch (error) {
    console.error('Save safety error:', error)
    return NextResponse.json({ error: 'Failed to save safety report' }, { status: 500 })
  }
}
