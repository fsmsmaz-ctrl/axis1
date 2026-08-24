'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error boundary caught:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <AlertTriangle className="h-8 w-8 text-red-600" />
        </div>
        <h2 className="text-xl font-bold">حدث خطأ غير متوقع</h2>
        <p className="text-muted-foreground text-sm">
          {error?.message || 'حدث خطأ أثناء تحميل الصفحة. يرجى المحاولة مرة أخرى.'}
        </p>
        <Button onClick={reset} variant="outline">
          إعادة المحاولة
        </Button>
      </div>
    </div>
  )
}
