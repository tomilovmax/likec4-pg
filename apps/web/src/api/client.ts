import {
  apiErrorSchema,
  diagramResponseSchema,
  fileContentResponseSchema,
  filesResponseSchema,
  type ApiError,
  type DiagramResponse,
  type FileContentResponse,
  type FilesResponse,
  type WorkspaceResponse,
  workspaceResponseSchema,
} from '@likec4-web-ide/contracts'

export class ApiClientError extends Error {
  constructor(readonly details: ApiError) {
    super(details.error.message)
  }
}

interface ResponseSchema<T> {
  parse(value: unknown): T
}

async function request<T>(path: string, schema: ResponseSchema<T>): Promise<T> {
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

/** Относительный путь файла кодируется по сегментам: `/` остаются разделителями. */
function fileUrl(relativePath: string): string {
  return `/api/files/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

export const api = {
  getWorkspace: (): Promise<WorkspaceResponse> =>
    request('/api/workspace', workspaceResponseSchema),
  listFiles: (): Promise<FilesResponse> => request('/api/files', filesResponseSchema),
  readFile: (relativePath: string): Promise<FileContentResponse> =>
    request(fileUrl(relativePath), fileContentResponseSchema),
  getDiagram: (): Promise<DiagramResponse> =>
    request('/api/diagram', diagramResponseSchema),
}
