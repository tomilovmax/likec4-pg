import type {
  DiagramResponse,
  FileContentResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

export interface WorkspacePort {
  getWorkspace(): Promise<WorkspaceResponse>
  listFiles(): Promise<FilesResponse>
  readFile(userPath: string): Promise<FileContentResponse>
  getDiagram(): Promise<DiagramResponse>
}
