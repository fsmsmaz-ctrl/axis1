import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'
import { handleDbError } from '@/lib/api-helpers'

// Get safety report for a daily report
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const safety = await db.safetyReport.findUnique({
      where: { dailyReportId: id },
    })

    return NextResponse.json({ safety })
  } catch (error) {
    return handleDbError(error, 'جلب تقرير السلامة')
  }
}

// Create or update safety report for a daily report
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id: dailyReportId } = await params
    const body = await req.json()

    // Get daily report to find projectId
    const dailyReport = await db.dailyReport.findUnique({
      where: { id: dailyReportId },
      select: { projectId: true, reportDate: true },
    })

    if (!dailyReport) {
      return NextResponse.json({ error: 'Daily report not found', details: `No daily report with id: ${dailyReportId}` }, { status: 404 })
    }

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
      observations: body.observations || null,
      violations: body.violations || null,
      incidentType: body.incidentType || 'none',
      incidentDescription: body.incidentDescription || null,
      signedBy: body.signedBy || user.name,
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

    // Audit log (non-critical, fire-and-forget)
    db.auditLog.create({
      data: {
        userId: user.id,
        projectId: dailyReport.projectId,
        dailyReportId,
        action: existing ? 'update' : 'create',
        entity: 'safety_report',
        entityId: safety.id,
        details: 'Saved safety checklist',
      },
    }).catch(() => {})

    return NextResponse.json({ safety })
  } catch (error) {
    return handleDbError(error, 'حفظ تقرير السلامة')
  }
}

