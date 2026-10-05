import { Component, type ErrorInfo, type ReactNode } from 'react'

interface DiagramErrorBoundaryProps {
  onRetry: () => void
  children: ReactNode
}

interface DiagramErrorBoundaryState {
  message: string | null
}

// REQ-15: ошибка renderer'а не должна ронять панель Diagram и приложение —
// только сам preview. Boundary — единственный class-компонент приложения:
// хукового эквивалента getDerivedStateFromError в React нет.
export class DiagramErrorBoundary extends Component<
  DiagramErrorBoundaryProps,
  DiagramErrorBoundaryState
> {
  state: DiagramErrorBoundaryState = { message: null }

  static getDerivedStateFromError(error: unknown): DiagramErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LikeC4 diagram renderer failed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="resource-state resource-state--error" role="alert">
          <p>Не удалось отрисовать диаграмму.</p>
          <p className="resource-state__detail">{this.state.message}</p>
          <button onClick={this.props.onRetry} type="button">
            Повторить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
