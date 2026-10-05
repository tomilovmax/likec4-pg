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
  /** REQ-10: успешное переименование — shell синхронизирует вкладку и dirty set. */
  onRenamed: (from: string, to: FileEntry) => void
}

export function FilesPanel({ dirtyPaths, selectedPath, onOpenFile, onRenamed }: FilesPanelProps) {
  const loadFiles = useCallback(() => api.listFiles(), [])
  const { state, reload } = useResource(loadFiles)

  // REQ-10: открыта одна форма переименования — запуск другой закрывает её.
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

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
          renamingPath={renamingPath}
          onStartRename={setRenamingPath}
          onOpenFile={onOpenFile}
          onRenamed={(from, to) => {
            // Дерево перечитывается из server state, форма закрывается.
            setRenamingPath(null)
            onRenamed(from, to)
            reload()
          }}
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
  renamingPath,
  onStartRename,
  onOpenFile,
  onRenamed,
}: {
  nodes: FileTreeNode[]
  dirtyPaths: ReadonlySet<string>
  selectedPath: string | null
  renamingPath: string | null
  onStartRename: (path: string | null) => void
  onOpenFile: (file: FileEntry) => void
  onRenamed: (from: string, to: FileEntry) => void
}) {
  return (
    <ul className="file-tree">
      {nodes.map((node) => (
        <li className="file-tree__item" key={node.entry.path}>
          {node.entry.kind === 'directory' ? (
            <span className="file-tree__directory">{node.entry.name}</span>
          ) : (
            <button
              aria-current={node.entry.path === selectedPath ? 'true' : undefined}
              aria-label={`Открыть ${node.entry.path}`}
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
          )}
          <button
            aria-label={`Переименовать ${node.entry.path}`}
            className="file-tree__rename"
            onClick={() => {
              // Повторный клик по той же записи закрывает форму.
              onStartRename(renamingPath === node.entry.path ? null : node.entry.path)
            }}
            title={`Переименовать ${node.entry.path}`}
            type="button"
          >
            ✎
          </button>
          {renamingPath === node.entry.path && (
            <RenameForm
              entry={node.entry}
              onCancel={() => onStartRename(null)}
              onRenamed={onRenamed}
            />
          )}
          {node.entry.kind === 'directory' && (
            <FileTreeList
              nodes={node.children}
              dirtyPaths={dirtyPaths}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onOpenFile={onOpenFile}
              onRenamed={onRenamed}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Валидация нового имени до запроса (REQ-10): имя — одиночная запись; файл
 * остаётся LikeC4-исходником (для config-файлов фиксированный список имён
 * проверяет сервер — инлайн-дублирование списка не делаем), каталог не
 * становится скрытым; unchanged-имя — no-op, submit недоступен.
 */
function resolveRenamedName(
  entry: FileEntry,
  rawName: string,
): { name: string | null; error: string | null } {
  const trimmed = rawName.trim()
  if (trimmed === '' || trimmed === entry.name) {
    return { name: null, error: null }
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { name: null, error: 'Имя не может содержать «/» или «\\».' }
  }
  if (entry.kind === 'directory') {
    if (trimmed.startsWith('.')) {
      return {
        name: null,
        error: 'Имя не может начинаться с точки — такая запись скрыта из дерева.',
      }
    }
    return { name: trimmed, error: null }
  }
  if (entry.language === 'likec4' && !/\.(c4|likec4)$/i.test(trimmed)) {
    return {
      name: null,
      error: 'Файл должен оставаться LikeC4-исходником: расширение .c4 или .likec4.',
    }
  }
  return { name: trimmed, error: null }
}

function RenameForm({
  entry,
  onCancel,
  onRenamed,
}: {
  entry: FileEntry
  onCancel: () => void
  onRenamed: (from: string, to: FileEntry) => void
}) {
  const [name, setName] = useState(entry.name)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  const resolved = resolveRenamedName(entry, name)
  const canSubmit = resolved.name !== null && !renaming
  // Ошибка запроса приоритетнее инлайн-валидации: она появляется после submit.
  const shownError = error ?? resolved.error
  const parentPath = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/')))

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const newName = resolved.name
    if (newName === null || renaming) {
      return
    }
    setRenaming(true)
    setError(null)
    void api.renameEntry({ path: entry.path, name: newName }).then(
      (renamed) => {
        setRenaming(false)
        onRenamed(entry.path, renamed)
      },
      (submitError: unknown) => {
        setRenaming(false)
        const isConflict =
          submitError instanceof ApiClientError &&
          submitError.details.error.code === 'CONFLICT'
        setError(
          isConflict
            ? `Запись «${newName}» уже существует в этом каталоге.`
            : submitError instanceof Error
              ? submitError.message
              : 'Не удалось переименовать запись',
        )
      },
    )
  }

  return (
    <form className="rename-entry" onSubmit={handleSubmit}>
      <label className="rename-entry__field">
        Новое имя
        <input
          className="rename-entry__input"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
          placeholder={entry.name}
          type="text"
          value={name}
        />
      </label>
      {resolved.name !== null && (
        <p className="rename-entry__hint" role="status">
          Будет: {parentPath === '' ? '' : `${parentPath}/`}
          {resolved.name}
        </p>
      )}
      {shownError !== null && (
        <p className="rename-entry__error" role="alert">
          {shownError}
        </p>
      )}
      <div className="rename-entry__actions">
        <button disabled={!canSubmit} type="submit">
          {renaming ? 'Переименовываем…' : 'Переименовать'}
        </button>
        {/* Cancel закрывает форму без API-запроса. */}
        <button onClick={onCancel} type="button">
          Отмена
        </button>
      </div>
    </form>
  )
}
