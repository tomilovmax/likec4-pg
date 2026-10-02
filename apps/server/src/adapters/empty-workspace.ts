import type {
  DiagramResponse,
  FilesResponse,
  WorkspaceResponse,
} from '@likec4-web-ide/contracts'

import type { WorkspacePort } from '../domain/workspace-port.js'

export class EmptyWorkspaceProvider implements WorkspacePort {
  async getWorkspace(): Promise<WorkspaceResponse> {
    return {
      status: 'unconfigured',
      displayName: 'Workspace',
    }
  }

  async listFiles(): Promise<FilesResponse> {
    return { items: [] }
  }

  async getDiagram(): Promise<DiagramResponse> {
    return {
      status: 'empty',
      reason: 'NO_WORKSPACE_VIEW',
    }
  }
}
