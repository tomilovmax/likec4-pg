import { CodeEditorPanel } from '../panels/code-editor-panel'
import { DiagramPanel } from '../panels/diagram-panel'
import { FilesPanel } from '../panels/files-panel'

export function DesktopShell() {
  return (
    <main className="desktop-shell">
      <FilesPanel />
      <CodeEditorPanel />
      <DiagramPanel />
    </main>
  )
}
