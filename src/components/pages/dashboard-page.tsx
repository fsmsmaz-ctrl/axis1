export default function DashboardPage({ onNavigate }: { onNavigate: (page: any) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const language = useAppStore((s) => s.language)
  const token = useAppStore((s) => s.token)
  const isRtl = language === 'ar'

  async function fetchDashboard() {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const r = await authedFetch('/api/dashboard')
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body?.details || body?.error || `Error ${r.status}`)
      }
      const d = await r.json()
      if (d.error) {
        throw new Error(d.details || d.error)
      }
      setData(d)
    } catch (e: any) {
      console.error('[Dashboard]', e)
      setError(e.message || (isRtl ? 'خطأ في تحميل البيانات' : 'Failed to load data'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
  }, [token])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-32 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-red-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-red-800">{isRtl ? 'فشل تحميل لوحة التحكم' : 'Failed to load dashboard'}</p>
            <p className="text-sm text-red-600/80 mt-1 max-w-md">{error}</p>
          </div>
          <Button variant="outline" onClick={fetchDashboard}>
            {isRtl ? 'إعادة المحاولة' : 'Retry'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null
