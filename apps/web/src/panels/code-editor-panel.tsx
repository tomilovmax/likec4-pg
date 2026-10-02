import { useCallback, useEffect, useState } from 'react'

import type { FileContentResponse, FileEntry } from '@likec4-web-ide/contracts'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { MonacoEditor } from '../editor/monaco-editor'
import { useResource } from '../hooks/use-resource'

interface CodeEditorPanelProps {
  selectedFile: FileEntry | null
  /** Сообщает об изменении dirty state активного buffer’а (только переходы). */
  onDirtyChange: (path: string, dirty: boolean) => void
}

type OpenFileRecord =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: FileContentResponse; dirty: boolean }

export function CodeEditorPanel({ selectedFile, onDirtyChange }: CodeEditorPanelProps) {
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFileRecord>>({})
  const [reloadCount, setReloadCount] = useState(0)

  const path = selectedFile?.path ?? null
  const record = path !== null ? openFiles[path] : undefined

  useEffect(() => {
    if (path === null) {
      return
    }

    // REQ-06: файл читается один раз за сессию — повторное открытие не
    // перечитывает его и не затирает unsaved buffer в модели редактора.
    // Чтение openFiles корректно без dep: эффект выполняется в свежем render’е
    // после смены path/reloadCount, а не по изменению самого openFiles.
    if (openFiles[path]?.status === 'ready') {
      return
    }
    setOpenFiles((current) => {
      if (current[path]?.status === 'ready') {
        return current
      }
      return { ...current, [path]: { status: 'loading' } }
    })

    let isCurrent = true
    void api.readFile(path).then(
      (content) => {
        if (isCurrent) {
          setOpenFiles((current) => ({ ...current, [path]: { content, dirty: false, status: 'ready' } }))
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setOpenFiles((current) => ({
            ...current,
            [path]: {
              status: 'error',
              message: error instanceof Error ? error.message : 'Request failed',
            },
          }))
        }
      },
    )

    return () => {
      isCurrent = false
    }
  }, [path, reloadCount])

  const handleBufferChange = useCallback(
    (value: string) => {
      if (path === null) {
        return
      }
      setOpenFiles((current) => {
        const existing = current[path]
        if (existing?.status !== 'ready') {
          return current
        }
        const dirty = value !== existing.content.content
        if (dirty === existing.dirty) {
          return current
        }
        return { ...current, [path]: { ...existing, dirty } }
      })
    },
    [path],
  )

  const isDirty = record?.status === 'ready' ? record.dirty : false
  const isReady = record?.status === 'ready'
  useEffect(() => {
    if (path !== null && isReady) {
      onDirtyChange(path, isDirty)
    }
  }, [isDirty, isReady, onDirtyChange, path])

  return (
    <Panel title="Code Editor">
      {selectedFile === null ? (
        <NoFileSelected />
      ) : record === undefined || record.status === 'loading' ? (
        <p className="resource-state">Открываем «{selectedFile.name}»…</p>
      ) : record.status === 'error' ? (
        <ResourceError
          message={record.message}
          onRetry={() => {
            setReloadCount((current) => current + 1)
          }}
        />
      ) : (
        <OpenedFile content={record.content} dirty={record.dirty} onBufferChange={handleBufferChange} />
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
 * REQ-06: редактируемый buffer. Текст файла приходит с backend’а буквальным
 * UTF-8 (REQ-05) и попадает в Monaco без format-on-load; dirty state —
 * сравнение buffer’а с сохранённым содержимым.
 */
function OpenedFile({
  content,
  dirty,
  onBufferChange,
}: {
  content: FileContentResponse
  dirty: boolean
  onBufferChange: (value: string) => void
}) {
  return (
    <div className="opened-file">
      <p className="opened-file__meta">
        {content.path}
        {dirty && (
          <span className="opened-file__dirty" role="status" title="Есть несохранённые изменения">
            {' ● не сохранён'}
          </span>
        )}
        <span className="opened-file__version" title={content.version}>
          {' '}· версия {content.version.slice(0, 12)}…
        </span>
      </p>
      <MonacoEditor
        ariaLabel={`Исходный текст ${content.path}`}
        initialValue={content.content}
        language={content.language}
        onChange={onBufferChange}
        path={content.path}
      />
    </div>
  )
}
