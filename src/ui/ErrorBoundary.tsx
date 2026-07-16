import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render-time crashes so a bug shows a readable message instead of a
 * blank page. Recovery data lives in IndexedDB, so a reload restores work.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Bartleby crashed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-ink-soft">
          <h1 className="font-serif text-2xl text-accent">Something went wrong</h1>
          <p className="max-w-md text-sm text-ink-soft">
            The app hit an unexpected error. Your work is auto-saved in this browser — reload to
            recover it.
          </p>
          <pre className="max-w-md overflow-x-auto rounded bg-panel p-3 text-left text-xs text-red-300">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-accent px-5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
