'use client'

import { Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  sectionName?: string
}

interface State {
  hasError: boolean
}

/**
 * F-3 FIX: Section-level error boundary.
 * Wraps individual page sections to prevent white screens.
 * If a section crashes, only that section shows an error — not the whole page.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Section error (' + (this.props.sectionName || 'unknown') + '):', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-muted-foreground/30 rounded-lg bg-muted/20 min-h-[200px]">
          <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
          <p className="text-sm text-muted-foreground mb-3">
            {this.props.sectionName ? 'حدث خطأ في تحميل: ' + this.props.sectionName : 'حدث خطأ في تحميل هذا القسم'}
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry} className="gap-2">
            <RefreshCw className="h-3 w-3" />
            إعادة المحاولة
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
