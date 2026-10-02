import { useCallback } from 'react'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

export function FilesPanel() {
  const loadFiles = useCallback(() => api.listFiles(), [])
  const { state, reload } = useResource(loadFiles)

  return (
    <Panel title="Files">
      {state.status === 'loading' && <p className="resource-state">Загружаем файлы…</p>}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && state.data.items.length === 0 && (
        <div className="resource-state">
          <p>В workspace пока нет файлов.</p>
          <p className="resource-state__detail">
            Дерево файлов workspace появится в следующем срезе.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.data.items.length > 0 && (
        <ul className="file-list">
          {state.data.items.map((item) => (
            <li key={item.path}>{item.name}</li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
