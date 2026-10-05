import {
  apiErrorSchema,
  diagramResponseSchema,
  fileContentResponseSchema,
  filesResponseSchema,
  type ApiError,
  type DiagramResponse,
  saveFileResponseSchema,
  type FileContentResponse,
  type FilesResponse,
  type SaveFileRequest,
  type SaveFileResponse,
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

async function request<T>(
  path: string,
  schema: ResponseSchema<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    ...init,
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

/** REQ-07: атомарное сохранение literal buffer с проверкой version token. */
async function putJson<T>(
  path: string,
  body: unknown,
  schema: ResponseSchema<T>,
): Promise<T> {
  return request(path, schema, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  getWorkspace: (): Promise<WorkspaceResponse> =>
    request('/api/workspace', workspaceResponseSchema),
  listFiles: (): Promise<FilesResponse> => request('/api/files', filesResponseSchema),
  readFile: (relativePath: string): Promise<FileContentResponse> =>
    request(fileUrl(relativePath), fileContentResponseSchema),
  saveFile: (relativePath: string, payload: SaveFileRequest): Promise<SaveFileResponse> =>
    putJson(fileUrl(relativePath), payload, saveFileResponseSchema),
  getDiagram: (): Promise<DiagramResponse> =>
    request('/api/diagram', diagramResponseSchema),
}
