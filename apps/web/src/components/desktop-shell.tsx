import { useCallback, useRef, useState } from 'react'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { CodeEditorPanel } from '../panels/code-editor-panel'
import { DiagramPanel } from '../panels/diagram-panel'
import { FilesPanel } from '../panels/files-panel'
import { remapRelativePath } from '../file-tree'

/** REQ-10: одна завершённая операция rename — подписана id для повтора. */
export interface PathRename {
  id: number
  from: string
  toPath: string
}

export function DesktopShell() {
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [lastRename, setLastRename] = useState<PathRename | null>(null)
  const renameCounter = useRef(0)

  // REQ-06: unsaved-состояние переживает переключение активного файла, поэтому
  // хранится на уровне shell, а не панели редактора.
  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((current) => {
      if (current.has(path) === dirty) {
        return current
      }
      const next = new Set(current)
      if (dirty) {
        next.add(path)
      } else {
        next.delete(path)
      }
      return next
    })
  }, [])

  // REQ-10: успешный rename перепривязывает активную вкладку и dirty-пути на
  // новый путь (переименованный каталог — вместе со всем содержимым), а
  // последний rename уходит в Code Editor для переноса открытых буферов.
  const handleRenamed = useCallback((from: string, to: FileEntry) => {
    setSelectedFile((current) => {
      if (current === null) {
        return current
      }
      if (current.path === from) {
        return to
      }
      const remapped = remapRelativePath(current.path, from, to.path)
      return remapped === null ? current : { ...current, path: remapped }
    })
    setDirtyPaths((current) => {
      const next = new Set<string>()
      let changed = false
      for (const path of current) {
        const remapped = remapRelativePath(path, from, to.path)
        if (remapped === null) {
          next.add(path)
        } else {
          changed = true
          next.add(remapped)
        }
      }
      return changed ? next : current
    })
    renameCounter.current += 1
    setLastRename({ id: renameCounter.current, from, toPath: to.path })
  }, [])

  return (
    <main className="desktop-shell">
      <FilesPanel
        dirtyPaths={dirtyPaths}
        selectedPath={selectedFile?.path ?? null}
        onOpenFile={setSelectedFile}
        onRenamed={handleRenamed}
      />
      <CodeEditorPanel
        selectedFile={selectedFile}
        lastRename={lastRename}
        onDirtyChange={handleDirtyChange}
      />
      <DiagramPanel />
    </main>
  )
}
