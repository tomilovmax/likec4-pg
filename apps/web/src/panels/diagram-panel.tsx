import { lazy, Suspense, useCallback, useState } from 'react'

import { api } from '../api/client'
import { DiagramErrorBoundary } from '../diagram/diagram-error-boundary'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

// Официальный renderer likec4/react весит ~2.5 МБ — грузим его отдельным
// чанком только когда есть что рендерить.
const LikeC4DiagramView = lazy(() => import('../diagram/likec4-diagram-view'))

export function DiagramPanel() {
  const loadDiagram = useCallback(() => api.getDiagram(), [])
  const { state, reload } = useResource(loadDiagram)
  // Внутренняя навигация preview между views (клик по элементу с navigateTo).
  // Выбор из списка views — REQ-16; до него показываем default view сервера.
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  // Remount renderer'а кнопкой «Повторить» в fallback ErrorBoundary.
  const [rendererAttempt, setRendererAttempt] = useState(0)

  const ready = state.status === 'ready' && state.data.status === 'ready' ? state.data : null
  const viewId =
    ready !== null && selectedViewId !== null && ready.views.some((view) => view.id === selectedViewId)
      ? selectedViewId
      : (ready?.defaultViewId ?? null)

  return (
    <Panel title="Diagram">
      {state.status === 'loading' && <p className="resource-state">Загружаем diagram…</p>}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && state.data.status === 'empty' && (
        <div className="resource-state">
          <p>Нет доступной LikeC4 view для отображения.</p>
          <p className="resource-state__detail">
            Определите view в .c4-файлах workspace и повторите попытку.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.data.status === 'invalid' && (
        <div className="resource-state resource-state--error" role="alert">
          <p>Модель проекта повреждена — актуальная диаграмма недоступна.</p>
          <p className="resource-state__detail">
            {state.data.diagnostics[0]?.message ?? 'Исправьте ошибки в LikeC4-файлах.'}
          </p>
          <button onClick={reload} type="button">
            Повторить
          </button>
        </div>
      )}
      {ready !== null && viewId !== null && (
        <DiagramErrorBoundary
          key={rendererAttempt}
          onRetry={() => {
            setRendererAttempt((attempt) => attempt + 1)
          }}
        >
          <Suspense fallback={<p className="resource-state">Загружаем LikeC4 renderer…</p>}>
            <div className="diagram-host">
              <LikeC4DiagramView
                model={ready.model}
                viewId={viewId}
                onNavigateTo={(nextViewId) => {
                  if (ready.views.some((view) => view.id === nextViewId)) {
                    setSelectedViewId(nextViewId)
                  }
                }}
              />
            </div>
          </Suspense>
        </DiagramErrorBoundary>
      )}
    </Panel>
  )
}
