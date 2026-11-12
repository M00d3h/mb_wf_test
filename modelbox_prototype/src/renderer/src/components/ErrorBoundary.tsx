import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-red-500">Something went wrong</h1>
          <pre className="max-w-xl overflow-auto rounded bg-neutral-100 p-4 text-left text-sm dark:bg-neutral-800">
            {error.message}
          </pre>
          <button
            className="rounded bg-neutral-200 px-4 py-2 text-sm hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
