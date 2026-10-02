import { useCallback } from 'react'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

export function DiagramPanel() {
  const loadDiagram = useCallback(() => api.getDiagram(), [])
  const { state, reload } = useResource(loadDiagram)

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
            Интерактивный preview будет использовать официальный @likec4/diagram.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.data.status === 'ready' && (
        <div className="resource-state">
          <p>Diagram готов к отображению.</p>
        </div>
      )}
    </Panel>
  )
}
