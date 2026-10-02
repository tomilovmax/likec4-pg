import {
  apiErrorSchema,
  diagramResponseSchema,
  filesResponseSchema,
  type ApiError,
  type DiagramResponse,
  type FilesResponse,
  type WorkspaceResponse,
  workspaceResponseSchema,
} from '@likec4-web-ide/contracts'
import type { ZodType } from 'zod'

export class ApiClientError extends Error {
  constructor(readonly details: ApiError) {
    super(details.error.message)
  }
}

async function request<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
  })
  const payload: unknown = await response.json()

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload)
    throw new ApiClientError(
      parsedError.success
        ? parsedError.data
        : {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'API returned an invalid error response',
            },
          },
    )
  }

  return schema.parse(payload)
}

export const api = {
  getWorkspace: (): Promise<WorkspaceResponse> =>
    request('/api/workspace', workspaceResponseSchema),
  listFiles: (): Promise<FilesResponse> => request('/api/files', filesResponseSchema),
  getDiagram: (): Promise<DiagramResponse> =>
    request('/api/diagram', diagramResponseSchema),
}
