import path from 'node:path'

import type {
  DiagramResponse,
  FileContentResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

import type { WorkspacePort } from '../domain/workspace-port.js'
import { WorkspacePathResolver } from '../workspace-paths.js'
import { readWorkspaceFile } from '../workspace-file.js'
import { listWorkspaceFiles } from '../workspace-tree.js'

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

  // REQ-04: дерево разрешённых LikeC4-файлов; обход идёт от доверенного корня
  // resolver’а, клиентский путь не участвует.
  async listFiles(): Promise<FilesResponse> {
    return { items: await listWorkspaceFiles(this.paths) }
  }

  // REQ-05: буквальный UTF-8 текст разрешённого файла и version token.
  async readFile(userPath: string): Promise<FileContentResponse> {
    return readWorkspaceFile(this.paths, userPath)
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
