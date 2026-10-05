import { useCallback, useState, type FormEvent } from 'react'

import type { CreateFileResponse, FileEntry } from '@likec4-web-ide/contracts'

import { api, ApiClientError } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { buildFileTree, type FileTreeNode } from '../file-tree'
import { useResource } from '../hooks/use-resource'

interface FilesPanelProps {
  /** Файлы с несохранёнными изменениями (REQ-06): заметны до возврата к файлу. */
  dirtyPaths: ReadonlySet<string>
  selectedPath: string | null
  onOpenFile: (file: FileEntry) => void
}

export function FilesPanel({ dirtyPaths, selectedPath, onOpenFile }: FilesPanelProps) {
  const loadFiles = useCallback(() => api.listFiles(), [])
  const { state, reload } = useResource(loadFiles)

  // Каталоги для выбора parent в формах создания (REQ-08/09); после REQ-09
  // сюда попадают и пустые каталоги — созданный каталог сразу можно выбрать.
  const directories =
    state.status === 'ready'
      ? state.data.items
          .filter((item) => item.kind === 'directory')
          .map((item) => item.path)
      : []

  return (
    <Panel title="Files">
      <div className="files-panel__actions">
        {/* REQ-08: создание доступно и для пустого workspace — это единственный
            способ появления первого .c4 файла без доступа к файловой системе. */}
        <CreateFileControl
          directories={directories}
          onCreated={(created) => {
            // Дерево обновляется перечитыванием server state, а не локальной
            // вставкой: UI не строит записи сам и не расходится с сервером.
            reload()
            onOpenFile({
              path: created.path,
              name: created.name,
              kind: 'file',
              language: 'likec4',
            })
          }}
        />
        <CreateDirectoryControl
          directories={directories}
          onCreated={() => {
            // Каталог не открывается в редакторе — только перечитываем дерево.
            reload()
          }}
        />
      </div>
      {state.status === 'loading' && <p className="resource-state">Загружаем файлы…</p>}
      {state.status === 'error' && (
        <ResourceError message={state.message} onRetry={reload} />
      )}
      {state.status === 'ready' && state.data.items.length === 0 && (
        <div className="resource-state">
          <p>В workspace нет LikeC4-файлов.</p>
          <p className="resource-state__detail">
            Разрешены файлы .c4 и .likec4, а также конфигурационные файлы LikeC4.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.data.items.length > 0 && (
        <FileTreeList
          nodes={buildFileTree(state.data.items)}
          dirtyPaths={dirtyPaths}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
        />
      )}
    </Panel>
  )
}

/**
 * Валидация имени до запроса (REQ-08): создаётся только .c4. Имя без
 * расширения дополняется — ввод «notes» создаёт notes.c4; расширение,
 * отличное от .c4, и path-подобные имена отклоняются инлайн без API-запроса.
 */
function resolveNewFileName(
  rawName: string,
): { name: string | null; error: string | null } {
  const trimmed = rawName.trim()
  if (trimmed === '') {
    return { name: null, error: null }
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { name: null, error: 'Имя не может содержать «/» или «\\».' }
  }
  if (trimmed.endsWith('.c4')) {
    return { name: trimmed, error: null }
  }
  if (trimmed.includes('.')) {
    return { name: null, error: 'Создать можно только файл с расширением .c4.' }
  }
  return { name: `${trimmed}.c4`, error: null }
}

function CreateFileControl({
  directories,
  onCreated,
}: {
  directories: string[]
  onCreated: (created: CreateFileResponse) => void
}) {
  const [open, setOpen] = useState(false)
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const resolved = resolveNewFileName(name)
  const canSubmit = resolved.name !== null && !creating
  // Ошибка запроса приоритетнее инлайн-валидации: она появляется после submit.
  const shownError = error ?? resolved.error

  if (!open) {
    return (
      <button
        className="create-file__toggle"
        onClick={() => {
          setOpen(true)
        }}
        type="button"
      >
        + Новый .c4 файл
      </button>
    )
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const newName = resolved.name
    if (newName === null || creating) {
      return
    }
    setCreating(true)
    setError(null)
    void api.createFile({ parent, name: newName }).then(
      (created) => {
        setOpen(false)
        setName('')
        setParent('')
        setCreating(false)
        onCreated(created)
      },
      (submitError: unknown) => {
        setCreating(false)
        const isConflict =
          submitError instanceof ApiClientError &&
          submitError.details.error.code === 'CONFLICT'
        setError(
          isConflict
            ? `Файл «${newName}» уже существует в выбранном каталоге.`
            : submitError instanceof Error
              ? submitError.message
              : 'Не удалось создать файл',
        )
      },
    )
  }

  const cancel = () => {
    setOpen(false)
    setName('')
    setParent('')
    setError(null)
  }

  return (
    <form className="create-file" onSubmit={handleSubmit}>
      <label className="create-file__field">
        Каталог
        <select
          className="create-file__select"
          onChange={(event) => {
            setParent(event.target.value)
            setError(null)
          }}
          value={parent}
        >
          <option value="">(корень workspace)</option>
          {directories.map((directory) => (
            <option key={directory} value={directory}>
              {directory}
            </option>
          ))}
        </select>
      </label>
      <label className="create-file__field">
        Имя файла
        <input
          className="create-file__input"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder="model-notes"
          type="text"
          value={name}
        />
      </label>
      {resolved.name !== null && (
        <p className="create-file__hint" role="status">
          Будет создан: {parent === '' ? '' : `${parent}/`}
          {resolved.name}
        </p>
      )}
      {shownError !== null && (
        <p className="create-file__error" role="alert">
          {shownError}
        </p>
      )}
      <div className="create-file__actions">
        <button disabled={!canSubmit} type="submit">
          {creating ? 'Создаём…' : 'Создать'}
        </button>
        <button onClick={cancel} type="button">
          Отмена
        </button>
      </div>
    </form>
  )
}

/**
 * Валидация имени до запроса (REQ-09): имя — одиночная запись без ведущей
 * точки (скрытый каталог не появился бы в дереве); path-подобные имена
 * отклоняются инлайн без API-запроса.
 */
function resolveNewDirectoryName(
  rawName: string,
): { name: string | null; error: string | null } {
  const trimmed = rawName.trim()
  if (trimmed === '') {
    return { name: null, error: null }
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { name: null, error: 'Имя не может содержать «/» или «\\».' }
  }
  if (trimmed.startsWith('.')) {
    return {
      name: null,
      error: 'Имя не может начинаться с точки — такая запись скрыта из дерева.',
    }
  }
  return { name: trimmed, error: null }
}

function CreateDirectoryControl({
  directories,
  onCreated,
}: {
  directories: string[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const resolved = resolveNewDirectoryName(name)
  const canSubmit = resolved.name !== null && !creating
  // Ошибка запроса приоритетнее инлайн-валидации: она появляется после submit.
  const shownError = error ?? resolved.error

  if (!open) {
    return (
      <button
        className="create-directory__toggle"
        onClick={() => {
          setOpen(true)
        }}
        type="button"
      >
        + Новый каталог
      </button>
    )
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const newName = resolved.name
    if (newName === null || creating) {
      return
    }
    setCreating(true)
    setError(null)
    void api.createDirectory({ parent, name: newName }).then(
      () => {
        setOpen(false)
        setName('')
        setParent('')
        setCreating(false)
        onCreated()
      },
      (submitError: unknown) => {
        setCreating(false)
        const isConflict =
          submitError instanceof ApiClientError &&
          submitError.details.error.code === 'CONFLICT'
        setError(
          isConflict
            ? `Каталог «${newName}» уже существует в выбранном каталоге.`
            : submitError instanceof Error
              ? submitError.message
              : 'Не удалось создать каталог',
        )
      },
    )
  }

  const cancel = () => {
    setOpen(false)
    setName('')
    setParent('')
    setError(null)
  }

  return (
    <form className="create-directory" onSubmit={handleSubmit}>
      <label className="create-directory__field">
        Каталог
        <select
          className="create-directory__select"
          onChange={(event) => {
            setParent(event.target.value)
            setError(null)
          }}
          value={parent}
        >
          <option value="">(корень workspace)</option>
          {directories.map((directory) => (
            <option key={directory} value={directory}>
              {directory}
            </option>
          ))}
        </select>
      </label>
      <label className="create-directory__field">
        Имя каталога
        <input
          className="create-directory__input"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder="notes"
          type="text"
          value={name}
        />
      </label>
      {resolved.name !== null && (
        <p className="create-directory__hint" role="status">
          Будет создан каталог: {parent === '' ? '' : `${parent}/`}
          {resolved.name}
        </p>
      )}
      {shownError !== null && (
        <p className="create-directory__error" role="alert">
          {shownError}
        </p>
      )}
      <div className="create-directory__actions">
        <button disabled={!canSubmit} type="submit">
          {creating ? 'Создаём…' : 'Создать'}
        </button>
        <button onClick={cancel} type="button">
          Отмена
        </button>
      </div>
    </form>
  )
}

function FileTreeList({
  nodes,
  dirtyPaths,
  selectedPath,
  onOpenFile,
}: {
  nodes: FileTreeNode[]
  dirtyPaths: ReadonlySet<string>
  selectedPath: string | null
  onOpenFile: (file: FileEntry) => void
}) {
  return (
    <ul className="file-tree">
      {nodes.map((node) =>
        node.entry.kind === 'directory' ? (
          <li className="file-tree__item" key={node.entry.path}>
            <span className="file-tree__directory">{node.entry.name}</span>
            <FileTreeList
              nodes={node.children}
              dirtyPaths={dirtyPaths}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
            />
          </li>
        ) : (
          <li className="file-tree__item" key={node.entry.path}>
            <button
              aria-current={node.entry.path === selectedPath ? 'true' : undefined}
              className="file-tree__open"
              data-language={node.entry.language}
              onClick={() => onOpenFile(node.entry)}
              title={`Открыть ${node.entry.path}`}
              type="button"
            >
              <span aria-hidden="true" className="file-tree__badge">
                {node.entry.language === 'config' ? 'CFG' : 'C4'}
              </span>
              <span className="file-tree__name">{node.entry.name}</span>
              {dirtyPaths.has(node.entry.path) && (
                <span aria-hidden="true" className="file-tree__dirty" title="Есть несохранённые изменения">
                  ●
                </span>
              )}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
