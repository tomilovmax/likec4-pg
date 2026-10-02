import { useCallback } from 'react'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { useResource } from '../hooks/use-resource'

interface CodeEditorPanelProps {
  selectedFile: FileEntry | null
}

export function CodeEditorPanel({ selectedFile }: CodeEditorPanelProps) {
  const loadWorkspace = useCallback(() => api.getWorkspace(), [])
  const { state, reload } = useResource(loadWorkspace)

  return (
    <Panel title="Code Editor">
      {state.status === 'loading' && <p className="resource-state">Подготавливаем редактор…</p>}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && selectedFile === null && (
        <div className="resource-state">
          <p>Выберите файл в панели Files, чтобы открыть его.</p>
          <p className="resource-state__detail">
            Workspace «{state.data.displayName}» готов к работе.
          </p>
        </div>
      )}
      {state.status === 'ready' && selectedFile !== null && (
        <div className="resource-state">
          <p>
            Файл «{selectedFile.name}» выбран для открытия.
          </p>
          <p className="resource-state__detail">
            Путь внутри workspace: {selectedFile.path}. Загрузка текста в редактор
            появится в следующем срезе.
          </p>
        </div>
      )}
    </Panel>
  )
}
