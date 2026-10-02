import path from 'node:path'

import type {
  DiagramResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

import type { WorkspacePort } from '../domain/workspace-port.js'

export class LocalWorkspaceProvider implements WorkspacePort {
  constructor(private readonly workspaceRoot: string) {}

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
