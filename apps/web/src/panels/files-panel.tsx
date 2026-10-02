import { useCallback } from 'react'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { api } from '../api/client'
import { Panel } from '../components/panel'
import { ResourceError } from '../components/resource-error'
import { buildFileTree, type FileTreeNode } from '../file-tree'
import { useResource } from '../hooks/use-resource'

interface FilesPanelProps {
  selectedPath: string | null
  onOpenFile: (file: FileEntry) => void
}

export function FilesPanel({ selectedPath, onOpenFile }: FilesPanelProps) {
  const loadFiles = useCallback(() => api.listFiles(), [])
  const { state, reload } = useResource(loadFiles)

  return (
    <Panel title="Files">
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
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
        />
      )}
    </Panel>
  )
}

function FileTreeList({
  nodes,
  selectedPath,
  onOpenFile,
}: {
  nodes: FileTreeNode[]
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
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
