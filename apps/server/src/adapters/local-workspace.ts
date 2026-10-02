import path from 'node:path'

import type {
  DiagramResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

import type { WorkspacePort } from '../domain/workspace-port.js'
import { WorkspacePathResolver } from '../workspace-paths.js'

export class LocalWorkspaceProvider implements WorkspacePort {
  // Единственный path guard (REQ-03): файловые операции REQ-04+ принимают от
  // клиента только относительный путь и резолвят его исключительно через него.
  private readonly paths: WorkspacePathResolver

  constructor(private readonly workspaceRoot: string) {
    this.paths = new WorkspacePathResolver(workspaceRoot)
  }

  async getWorkspace(): Promise<WorkspaceResponse> {
    return {
      status: 'ready',
      displayName: this.displayName(),
    }
  }

  // Placeholder до REQ-04: дерево разрешённых файлов ещё не строится.
  async listFiles(): Promise<FilesResponse> {
    return { items: [] }
  }

  // Placeholder до REQ-15: diagram preview ещё не подключён.
  async getDiagram(): Promise<DiagramResponse> {
    return { status: 'empty', reason: 'NO_WORKSPACE_VIEW' }
  }

  // basename нормализованного configured-пути: symlink-цель и absolute path хоста не раскрываются.
  private displayName(): string {
    const name = path.basename(this.workspaceRoot)
    return name === '' || name === '/' ? 'workspace' : name
  }
}
