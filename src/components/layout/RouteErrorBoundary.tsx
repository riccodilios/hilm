import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type Props = WithTranslation & { children: ReactNode; title?: string }
type State = { error: Error | null }

class RouteErrorBoundaryBase extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[hilm] route error', error, info.componentStack)
  }

  render() {
    const { t } = this.props
    if (this.state.error) {
      return (
        <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 rounded-2xl border border-border-subtle bg-surface/40 p-8 text-center">
          <p className="text-lg font-medium">
            {this.props.title ?? t('errors.generic', { defaultValue: 'Something went wrong' })}
          </p>
          <p className="max-w-md text-sm text-muted">{this.state.error.message}</p>
          <Button
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
          >
            {t('common.reload', { defaultValue: 'Reload' })}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

export const RouteErrorBoundary = withTranslation()(RouteErrorBoundaryBase)
