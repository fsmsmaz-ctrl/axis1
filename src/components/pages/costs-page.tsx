  async function fetchCosts() {
    setLoading(true)
    const [costsRes, repRes] = await Promise.all([
      authedFetch('/api/costs' + (selectedProject !== 'all' ? `?projectId=${selectedProject}` : '')),
      (async () => {
        const repParams = new URLSearchParams()
        if (selectedProject !== 'all') repParams.set('projectId', selectedProject)
        repParams.set('limit', '500')
        return authedFetch('/api/daily-reports?' + repParams.toString())
      })(),
    ])
    const data = await costsRes.json()
    setCosts(data.costs || [])
    setByCategory(data.byCategory || [])
    setTotal(data.total || 0)

    const repData = await repRes.json()
    const reports = (repData.reports || []).filter((r: any) => r.status === 'approved')
    const totalRev = reports.reduce((s: number, r: any) => s + r.dailyRevenue, 0)
    setRevenue(totalRev)
    setProjectReports(reports)

    setLoading(false)
  }
