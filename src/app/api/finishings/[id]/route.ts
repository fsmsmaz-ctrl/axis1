import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth-server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const finishing = await db.finishing.findUnique({
    where: { id },
    include: {
      project: true,
      signedByUser: true,
      attachments: true,
    },
  })

  if (!finishing) {
    return NextResponse.json({ error: 'Finishing not found' }, { status: 404 })
  }

  return NextResponse.json({ finishing })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json()

  try {
    const finishing = await db.finishing.update({
      where: { id },
      data: {
        siteCleaned: !!body.siteCleaned,
        wasteRemoved: !!body.wasteRemoved,
        shaftClosed: !!body.shaftClosed,
        siteRestored: !!body.siteRestored,
        lineHandover: !!body.lineHandover,
        clientNotes: body.clientNotes,
        handoverStatus: body.handoverStatus,
      },
    })

    return NextResponse.json({ finishing })
  } catch (error) {
    console.error('Update finishing error:', error)
    return NextResponse.json({ error: 'Failed to update finishing' }, { status: 500 })
  }
}
