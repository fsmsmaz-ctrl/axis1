'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Calendar } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { authedFetch } from '@/lib/api-client'

const incidentLabels: Record<string, { ar: string; en: string; color: string }> = {
  none: { ar: 'لا يوجد', en: 'None', color: 'secondary' },
  near_miss: { ar: 'Near miss', en: 'Near miss', color: 'default' },
  incident: { ar: 'حادث', en: 'Incident', color: 'destructive' },
  accident: { ar: 'إصابة', en: 'Accident', color: 'destructive' },
}

// Safety check keys - defined once outside component
const SAFETY_CHECK_KEYS = [
  'ppeAvailable', 'helmetCheck', 'bootsCheck', 'glovesCheck', 'glassesCheck',
  'workAreaCheck', 'barriersCheck', 'shaftCheck', 'ventilationCheck',
  'electricalCheck', 'craneCheck', 'hydraulicCheck', 'fireExtinguishers',
  'workPermit', 'toolboxTalk',
] as const

function calcCompliance(safety: any): number {
  const passed = SAFETY_CHECK_KEYS.filter(k => safety?.[k]).length
  return (passed / 15) * 100
}

export default function SafetyPage() {
  const [reports, setReports] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('all')
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  useEffect(() => {
    if (!token) return
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedProject !== 'all') params.set('projectId', selectedProject)
    params.set('limit', '100')

    Promise.all([
      authedFetch('/api/daily-reports?' + params.toString()),
      authedFetch('/api/projects/list'),
    ]).then(async ([repRes, projRes]) => {
      const repData = await repRes.json()
      const projData = await projRes.json()
      setReports((repData.reports || []).filter((r: any) => r.safety))
      setProjects(projData.projects || [])
    }).finally(() => setLoading(false))
  }, [selectedProject, token])

  // Memoize heavy computation
  const { total, incidents, avgCompliance } = useMemo(() => {
    const t = reports.length
    const inc = reports.filter(r => r.safety?.incidentType && r.safety.incidentType !== 'none').length
    const avg = t > 0
      ? reports.reduce((sum, r) => sum + calcCompliance(r.safety), 0) / t
      : 0
    return { total: t, incidents: inc, avgCompliance: avg }
  }, [reports])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{isRtl ? 'السلامة' : 'Safety'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isRtl ? 'تقارير السلامة اليومية والمخاطر' : 'Daily safety reports and hazards'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{total}</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'تقارير السلامة' : 'Safety reports'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-emerald-50 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgCompliance.toFixed(1)}%</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'متوسط الالتزام' : 'Avg compliance'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{incidents}</p>
                <p className="text-sm text-muted-foreground">{isRtl ? 'حوادث / near miss' : 'Incidents'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Select value={selectedProject} onValueChange={setSelectedProject}>
        <SelectTrigger className="w-full sm:w-[300px]">
          <SelectValue placeholder={isRtl ? 'اختر المشروع' : 'Select project'} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{isRtl ? 'كل المشاريع' : 'All Projects'}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="h-32 bg-muted animate-pulse rounded" />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-muted-foreground">{isRtl ? 'لا توجد تقارير سلامة' : 'No safety reports'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const compliance = calcCompliance(r.safety)
            const incident = incidentLabels[r.safety.incidentType || 'none']
            const hasIncident = r.safety.incidentType && r.safety.incidentType !== 'none'

            return (
              <Card key={r.id} className={hasIncident ? 'border-destructive/30' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      hasIncident ? 'bg-destructive/10' : compliance === 100 ? 'bg-emerald-50' : 'bg-orange-50'
                    }`}>
                      {hasIncident ? (
                        <ShieldAlert className="h-5 w-5 text-destructive" />
                      ) : compliance === 100 ? (
                        <ShieldCheck className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-orange-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-sm">{r.project?.name}</p>
                        <Badge variant="outline" className="text-xs">{r.driveLine?.lineNumber || '-'}</Badge>
                        {hasIncident && (
                          <Badge variant={incident.color as any} className="text-xs">
                            {isRtl ? incident.ar : incident.en}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {new Date(r.reportDate).toLocaleDateString(isRtl ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        {' • '}
                        {isRtl ? 'موقّع من' : 'Signed by'}: {r.safety.signedBy || '-'}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <Progress value={compliance} className="h-1.5 flex-1" />
                        <span className="text-xs font-medium">{SAFETY_CHECK_KEYS.filter(k => r.safety?.[k]).length}/15</span>
                      </div>
                      {r.safety.observations && (
                        <p className="text-xs text-muted-foreground">{r.safety.observations}</p>
                      )}
                      {r.safety.violations && (
                        <p className="text-xs text-orange-600 mt-1">⚠ {r.safety.violations}</p>
                      )}
                      {r.safety.incidentDescription && (
                        <p className="text-xs text-destructive mt-1">🚨 {r.safety.incidentDescription}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
