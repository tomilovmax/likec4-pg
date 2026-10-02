import type {
  DiagramResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

export interface WorkspacePort {
  getWorkspace(): Promise<WorkspaceResponse>
  listFiles(): Promise<FilesResponse>
  getDiagram(): Promise<DiagramResponse>
}
