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
  return (
    <Panel title="Code Editor">
      {selectedFile === null ? (
        <NoFileSelected />
      ) : (
        // key сбрасывает состояние загрузки при смене открываемого файла.
        <OpenedFile key={selectedFile.path} file={selectedFile} />
      )}
    </Panel>
  )
}

function NoFileSelected() {
  const loadWorkspace = useCallback(() => api.getWorkspace(), [])
  const { state, reload } = useResource(loadWorkspace)

  return (
    <>
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
    </>
  )
}

/**
 * REQ-05: открытый файл. Текст приходит с backend’а буквальным UTF-8 и
 * показывается без format-on-load. Поверхность — read-only code view:
 * textarea по спецификации HTML нормализует CRLF в LF, а буквальность
 * переводов строк — критерий приёмки. Редактируемый buffer (Monaco) и dirty
 * state — предмет REQ-06.
 */
function OpenedFile({ file }: { file: FileEntry }) {
  const loadContent = useCallback(() => api.readFile(file.path), [file.path])
  const { state, reload } = useResource(loadContent)

  return (
    <div className="opened-file">
      {state.status === 'loading' && (
        <p className="resource-state">Открываем «{file.name}»…</p>
      )}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && (
        <>
          <p className="opened-file__meta">
            {state.data.path}
            <span className="opened-file__version" title={state.data.version}>
              {' '}· версия {state.data.version.slice(0, 12)}…
            </span>
          </p>
          <pre aria-label={`Исходный текст ${state.data.name}`} className="opened-file__code">
            {state.data.content}
          </pre>
        </>
      )}
    </div>
  )
}
