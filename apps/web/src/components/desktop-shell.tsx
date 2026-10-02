import { useState } from 'react'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { CodeEditorPanel } from '../panels/code-editor-panel'
import { DiagramPanel } from '../panels/diagram-panel'
import { FilesPanel } from '../panels/files-panel'

export function DesktopShell() {
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)

  return (
    <main className="desktop-shell">
      <FilesPanel
        selectedPath={selectedFile?.path ?? null}
        onOpenFile={setSelectedFile}
      />
      <CodeEditorPanel selectedFile={selectedFile} />
      <DiagramPanel />
    </main>
  )
}
