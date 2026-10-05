import { lazy, Suspense, useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import { DiagramErrorBoundary } from '../diagram/diagram-error-boundary'
import {
  readSelectedViewFromLocation,
  writeSelectedViewToLocation,
} from '../diagram/view-selection'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

// Официальный renderer likec4/react весит ~2.5 МБ — грузим его отдельным
// чанком только когда есть что рендерить.
const LikeC4DiagramView = lazy(() => import('../diagram/likec4-diagram-view'))

export function DiagramPanel() {
  const loadDiagram = useCallback(() => api.getDiagram(), [])
  const { state, reload } = useResource(loadDiagram)
  // REQ-16: view, выбранная пользователем — из списка views модели либо
  // внутренней навигации preview. Восстанавливается из URL hash (#view=…),
  // поэтому selection переживает refresh; null — показываем default сервера.
  const [selectedViewId, setSelectedViewId] = useState<string | null>(() =>
    readSelectedViewFromLocation(),
  )
  // REQ-16 fallback: id view, исчезнувшей из модели после загрузки данных.
  const [missingViewNotice, setMissingViewNotice] = useState<string | null>(null)
  // Remount renderer'а кнопкой «Повторить» в fallback ErrorBoundary.
  const [rendererAttempt, setRendererAttempt] = useState(0)

  const ready = state.status === 'ready' && state.data.status === 'ready' ? state.data : null
  const viewId =
    ready !== null && selectedViewId !== null && ready.views.some((view) => view.id === selectedViewId)
      ? selectedViewId
      : (ready?.defaultViewId ?? null)

  // URL всегда отражает показанную view — refresh страницы восстанавливает
  // selection, включая безопасный fallback после исчезновения view.
  useEffect(() => {
    if (viewId !== null) {
      writeSelectedViewToLocation(viewId)
    }
  }, [viewId])

  // REQ-16 fallback: после загрузки новой модели выбранной view в списке нет —
  // показываем серверский default с понятным сообщением, а не пустую панель.
  useEffect(() => {
    if (ready === null || selectedViewId === null) {
      return
    }
    if (!ready.views.some((view) => view.id === selectedViewId)) {
      setMissingViewNotice(selectedViewId)
      setSelectedViewId(null)
    }
  }, [ready, selectedViewId])

  const selectView = useCallback((nextViewId: string) => {
    setSelectedViewId(nextViewId)
    setMissingViewNotice(null)
  }, [])

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
        <>
          <div className="diagram-toolbar">
            <label className="diagram-toolbar__label" htmlFor="diagram-view">
              View
            </label>
            <select
              className="diagram-toolbar__select"
              id="diagram-view"
              value={viewId}
              onChange={(event) => {
                selectView(event.target.value)
              }}
            >
              {ready.views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.title ?? view.id}
                </option>
              ))}
            </select>
          </div>
          {missingViewNotice !== null && (
            <p className="diagram-view-notice" role="status">
              View «{missingViewNotice}» больше не существует в модели — показана view «
              {ready.views.find((view) => view.id === viewId)?.title ?? viewId}».
            </p>
          )}
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
                      selectView(nextViewId)
                    }
                  }}
                />
              </div>
            </Suspense>
          </DiagramErrorBoundary>
        </>
      )}
    </Panel>
  )
}
