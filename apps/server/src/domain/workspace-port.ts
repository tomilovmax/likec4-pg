import type {
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
  getProject(): Promise<ProjectResponse>
  getDiagram(): Promise<DiagramResponse>
}
