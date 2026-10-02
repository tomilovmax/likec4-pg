import { useCallback, useState } from 'react'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { CodeEditorPanel } from '../panels/code-editor-panel'
import { DiagramPanel } from '../panels/diagram-panel'
import { FilesPanel } from '../panels/files-panel'

export function DesktopShell() {
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(() => new Set())

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

  return (
    <main className="desktop-shell">
      <FilesPanel
        dirtyPaths={dirtyPaths}
        selectedPath={selectedFile?.path ?? null}
        onOpenFile={setSelectedFile}
      />
      <CodeEditorPanel selectedFile={selectedFile} onDirtyChange={handleDirtyChange} />
      <DiagramPanel />
    </main>
  )
}
