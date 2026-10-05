import type {
  CreateDirectoryResponse,
  DiagramResponse,
  FileContentResponse,
  FilesResponse,
  ProjectResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

export interface WorkspacePort {
  getWorkspace(): Promise<WorkspaceResponse>
  listFiles(): Promise<FilesResponse>
  readFile(userPath: string): Promise<FileContentResponse>
  saveFile(
    userPath: string,
    content: string,
    version: string,
  ): Promise<FileContentResponse>
  // REQ-08: неперезаписывающее создание нового .c4 файла в существующем каталоге.
  createFile(parent: string, name: string): Promise<FileContentResponse>
  // REQ-09: создание одного нового каталога в существующем parent directory.
  createDirectory(parent: string, name: string): Promise<CreateDirectoryResponse>
  getProject(): Promise<ProjectResponse>
  getDiagram(): Promise<DiagramResponse>
}
