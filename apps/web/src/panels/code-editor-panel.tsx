import { useCallback } from 'react'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

export function CodeEditorPanel() {
  const loadWorkspace = useCallback(() => api.getWorkspace(), [])
  const { state, reload } = useResource(loadWorkspace)

  return (
    <Panel title="Code Editor">
      {state.status === 'loading' && <p className="resource-state">Подготавливаем редактор…</p>}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <div className="resource-state">
          <p>Выберите файл в панели Files, чтобы открыть его.</p>
          <p className="resource-state__detail">
            Workspace «{state.data.displayName}» готов к работе.
          </p>
        </div>
      )}
    </Panel>
  )
}
