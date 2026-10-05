import path from 'node:path'

import type {
  CreateDirectoryResponse,
  DiagramResponse,
  FileContentResponse,
  FileEntry,
  FilesResponse,
  ProjectResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

import type { WorkspacePort } from '../domain/workspace-port.js'
import { WorkspacePathResolver } from '../workspace-paths.js'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  readWorkspaceFile,
  renameWorkspaceEntry,
  saveWorkspaceFile,
} from '../workspace-file.js'
import { listWorkspaceFiles } from '../workspace-tree.js'
import { loadWorkspaceDiagram } from '../workspace-diagram.js'
import { loadWorkspaceProject } from '../workspace-project.js'

export class LocalWorkspaceProvider implements WorkspacePort {
  // Единственный path guard (REQ-03): файловые операции REQ-04+ принимают от
  // клиента только относительный путь и резолвят его исключительно через него.
  private readonly paths: WorkspacePathResolver

  // REQ-14: single-flight загрузка модели — параллельные запросы делят одну
  // загрузку. Это не кэш: promise очищается по завершении, следующий запрос
  // парсит workspace заново (семантика reparse — REQ-17).
  private projectLoad: Promise<ProjectResponse> | undefined

  // REQ-15: single-flight layouted-модели, отдельный от projectLoad — формы
  // ответов разошлись, объединённый loader не делаем. Двойной парсинг при
  // вызове обоих endpoints — задокументированное ограничение (docs/architecture.md).
  private diagramLoad: Promise<DiagramResponse> | undefined

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

  // REQ-07: атомарное сохранение literal buffer с optimistic проверкой version
  // token; тот же path guard REQ-03 и классификатор REQ-04, что и у чтения.
  async saveFile(
    userPath: string,
    content: string,
    version: string,
  ): Promise<FileContentResponse> {
    return saveWorkspaceFile(this.paths, userPath, { content, version })
  }

  // REQ-08: неперезаписывающее создание .c4 файла; тот же path guard REQ-03,
  // что и у остальных файловых операций.
  async createFile(parent: string, name: string): Promise<FileContentResponse> {
    return createWorkspaceFile(this.paths, { parent, name })
  }

  // REQ-09: создание одного каталога без recursion; тот же path guard REQ-03.
  async createDirectory(
    parent: string,
    name: string,
  ): Promise<CreateDirectoryResponse> {
    return createWorkspaceDirectory(this.paths, { parent, name })
  }

  // REQ-10: rename в том же каталоге через общий guard REQ-03 (source —
  // resolveExisting, destination — resolveChild) без неявного overwrite.
  async renameEntry(userPath: string, name: string): Promise<FileEntry> {
    return renameWorkspaceEntry(this.paths, { path: userPath, name })
  }

  // REQ-14: полная multi-file модель из доверенного realpath-корня REQ-03;
  // клиентский путь не участвует — parsing context всегда весь workspace.
  async getProject(): Promise<ProjectResponse> {
    this.projectLoad ??= this.paths
      .trustedRoot()
      .then(loadWorkspaceProject)
      .finally(() => {
        this.projectLoad = undefined
      })
    return this.projectLoad
  }

  // REQ-15: layouted-модель из доверенного realpath-корня REQ-03; клиентский
  // путь не участвует — diagram всегда строится из всего workspace.
  async getDiagram(): Promise<DiagramResponse> {
    this.diagramLoad ??= this.paths
      .trustedRoot()
      .then(loadWorkspaceDiagram)
      .finally(() => {
        this.diagramLoad = undefined
      })
    return this.diagramLoad
  }

  // basename нормализованного configured-пути: symlink-цель и absolute path хоста не раскрываются.
  private displayName(): string {
    const name = path.basename(this.workspaceRoot)
    return name === '' || name === '/' ? 'workspace' : name
  }
}
