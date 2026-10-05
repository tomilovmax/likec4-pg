import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileContentResponse, FileEntry } from '@likec4-web-ide/contracts'

import { api, ApiClientError } from '../api/client'
import { loadWorkspaceSources, type SourceLoadFailure } from '../api/workspace-sources'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import {
  likeC4LanguageRuntime,
  markerSeverityLabel,
  type DiagnosticsByPath,
  type LanguageRuntimeStatus,
} from '../editor/likec4-language-runtime'
import { MonacoEditor } from '../editor/monaco-editor'
import { useResource } from '../hooks/use-resource'

interface CodeEditorPanelProps {
  selectedFile: FileEntry | null
  /** Сообщает об изменении dirty state активного buffer’а (только переходы). */
  onDirtyChange: (path: string, dirty: boolean) => void
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'conflict'; message: string }
  | { status: 'error'; message: string }

type OpenFileRecord =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      content: FileContentResponse
      /** REQ-07: редактируемый buffer поверх сохранённого текста. */
      buffer: string
      save: SaveState
      dirty: boolean
    }

type SourceLoadState =
  | { status: 'loading' }
  | { status: 'ready'; failures: readonly SourceLoadFailure[] }
  | { status: 'error'; message: string }

export function CodeEditorPanel({ selectedFile, onDirtyChange }: CodeEditorPanelProps) {
  const [openFiles, setOpenFiles] = useState<Record<string, OpenFileRecord>>({})
  const [reloadCount, setReloadCount] = useState(0)
  const [sourceLoad, setSourceLoad] = useState<SourceLoadState>({ status: 'ready', failures: [] })
  const [diagnostics, setDiagnostics] = useState<DiagnosticsByPath>({})
  const [languageStatus, setLanguageStatus] = useState<LanguageRuntimeStatus>('idle')
  const [languageError, setLanguageError] = useState<string | null>(null)
  const loadedSourcesForReload = useRef<number | null>(null)

  const path = selectedFile?.path ?? null
  const record = path !== null ? openFiles[path] : undefined
  const activeLikeC4Content =
    record?.status === 'ready' && record.content.language === 'likec4' ? record.content : null

  useEffect(() => {
    return likeC4LanguageRuntime.subscribe((snapshot) => {
      setDiagnostics(snapshot.diagnostics)
      setLanguageStatus(snapshot.status)
      setLanguageError(snapshot.error)
    })
  }, [])

  useEffect(() => {
    if (activeLikeC4Content === null || loadedSourcesForReload.current === reloadCount) {
      return
    }
    loadedSourcesForReload.current = reloadCount
    let isCurrent = true
    setSourceLoad({ status: 'loading' })
    void loadWorkspaceSources({
      path: activeLikeC4Content.path,
      content: activeLikeC4Content.content,
    }).then(
      async ({ failures, sources }) => {
        try {
          await likeC4LanguageRuntime.syncSources(sources)
          if (isCurrent) {
            setSourceLoad({ status: 'ready', failures })
          }
        } catch (error: unknown) {
          if (isCurrent) {
            setSourceLoad({
              status: 'error',
              message: error instanceof Error ? error.message : 'Не удалось подготовить LikeC4 документы',
            })
          }
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setSourceLoad({
            status: 'error',
            message: error instanceof Error ? error.message : 'Не удалось загрузить LikeC4 документы',
          })
        }
      },
    )
    return () => {
      isCurrent = false
    }
  }, [activeLikeC4Content?.content, activeLikeC4Content?.path, reloadCount])

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
          setOpenFiles((current) => ({
            ...current,
            [path]: {
              content,
              buffer: content.content,
              dirty: false,
              save: { status: 'idle' },
              status: 'ready',
            }
          }))
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
        if (existing.content.language === 'likec4') {
          likeC4LanguageRuntime.updateSource(path, value)
        }
        if (dirty === existing.dirty && value === existing.buffer) {
          return current
        }
        return { ...current, [path]: { ...existing, buffer: value, dirty } }
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

  /**
   * REQ-07: сохранение literal buffer активного файла с optimistic проверкой
   * версии. Отправляется buffer на момент вызова; если он изменился во время
   * запроса, сохранённая база обновляется, но buffer и dirty сохраняются.
   */
  const saveActiveFile = useCallback(() => {
    if (path === null) {
      return
    }
    const currentRecord = openFiles[path]
    if (currentRecord?.status !== 'ready') {
      return
    }
    const { content, buffer, dirty } = currentRecord
    if (currentRecord.save.status === 'saving') {
      return
    }
    if (!dirty && buffer === content.content) {
      return
    }

    setOpenFiles((current) => {
      const record = current[path]
      if (record?.status !== 'ready') {
        return current
      }
      return { ...current, [path]: { ...record, save: { status: 'saving' } } }
    })

    void api
      .saveFile(content.path, { content: buffer, version: content.version })
      .then(
        (saved) => {
          setOpenFiles((current) => {
            const record = current[path]
            if (record?.status !== 'ready') {
              return current
            }
            // Race guard: buffer могли изменить во время запроса. База
            // (сохранённый текст и version) обновляется, dirty пересчитывается
            // от нового buffer.
            const dirtyNow = record.buffer !== saved.content
            return {
              ...current,
              [path]: {
                ...record,
                content: { ...saved, content: saved.content },
                dirty: dirtyNow,
                save: { status: 'idle' },
              },
            }
          })
        },
        (error: unknown) => {
          setOpenFiles((current) => {
            const record = current[path]
            if (record?.status !== 'ready') {
              return current
            }
            const isConflict =
              error instanceof ApiClientError && error.details.error.code === 'CONFLICT'
            const message = isConflict
              ? 'Файл изменён вне IDE. Перезагрузите страницу, чтобы увидеть актуальную версию, и повторите сохранение.'
              : error instanceof Error
                ? error.message
                : 'Не удалось сохранить файл'
            return {
              ...current,
              [path]: {
                ...record,
                // Buffer и dirty state не сбрасываются: неудачный save не
                // теряет пользовательский ввод.
                save: { status: isConflict ? 'conflict' : 'error', message },
              },
            }
          })
        },
      )
  }, [openFiles, path])

  useEffect(() => {
    if (path === null) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveActiveFile()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [path, saveActiveFile])

  return (
    <Panel title="Code Editor">
      <LanguageRuntimeStatus
        error={languageError}
        languageStatus={languageStatus}
        sourceLoad={sourceLoad}
        onRetry={() => {
          setReloadCount((current) => current + 1)
          void likeC4LanguageRuntime.retry()
        }}
      />
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
        <OpenedFile
          content={record.content}
          diagnostics={diagnostics[record.content.path] ?? []}
          dirty={record.dirty}
          save={record.save}
          onBufferChange={handleBufferChange}
        />
      )}
    </Panel>
  )
}

function LanguageRuntimeStatus({
  error,
  languageStatus,
  onRetry,
  sourceLoad,
}: {
  error: string | null
  languageStatus: LanguageRuntimeStatus
  onRetry: () => void
  sourceLoad: SourceLoadState
}) {
  const sourceLoadError = sourceLoad.status === 'error' ? sourceLoad.message : null
  if (error !== null || sourceLoadError !== null) {
    return (
      <div className="language-runtime-error" role="alert">
        <span>{error ?? sourceLoadError}</span>
        <button type="button" onClick={onRetry}>Повторить language service</button>
      </div>
    )
  }
  if (sourceLoad.status === 'loading' || languageStatus === 'starting') {
    return <p className="language-runtime-status" role="status">Подготавливаем LikeC4 language service…</p>
  }
  if (sourceLoad.status === 'ready' && sourceLoad.failures.length > 0) {
    return (
      <p className="language-runtime-status" role="status">
        Не удалось загрузить {sourceLoad.failures.length} LikeC4-документ(а): редактор остальных файлов доступен.
      </p>
    )
  }
  return null
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
 * REQ-06/19: редактируемый buffer и diagnostics независимы. Текст приходит с
 * backend’а буквально, не форматируется и не записывается browser runtime’ом.
 */
function OpenedFile({
  content,
  diagnostics,
  dirty,
  save,
  onBufferChange,
}: {
  content: FileContentResponse
  diagnostics: readonly import('../editor/likec4-language-runtime').LikeC4Diagnostic[]
  dirty: boolean
  save: SaveState
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
        {save.status === 'saving' && (
          <span className="opened-file__saving" role="status">
            {' сохраняем…'}
          </span>
        )}
        {(save.status === 'conflict' || save.status === 'error') && (
          <span className="opened-file__save-error" role="alert">
            {save.status === 'conflict' ? ' ⚠ конфликт записи' : ` ⚠ ${save.message}`}
          </span>
        )}
        <span className="opened-file__version" title={content.version}>
          {' '}· версия {content.version.slice(0, 12)}…
        </span>
      </p>
      <Diagnostics diagnostics={diagnostics} />
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

function Diagnostics({
  diagnostics,
}: {
  diagnostics: readonly import('../editor/likec4-language-runtime').LikeC4Diagnostic[]
}) {
  if (diagnostics.length === 0) {
    return null
  }
  return (
    <ul className="editor-diagnostics" aria-label="Диагностика LikeC4">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.message}-${diagnostic.range.startLineNumber}-${index}`}>
          <strong>{markerSeverityLabel(diagnostic.severity)}:</strong>{' '}
          строка {diagnostic.range.startLineNumber}, столбец {diagnostic.range.startColumn} — {diagnostic.message}
        </li>
      ))}
    </ul>
  )
}
