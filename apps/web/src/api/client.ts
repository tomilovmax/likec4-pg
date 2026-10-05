import {
  apiErrorSchema,
  createDirectoryResponseSchema,
  createFileResponseSchema,
  type ApiError,
  type CreateDirectoryRequest,
  type CreateDirectoryResponse,
  type CreateFileRequest,
  type CreateFileResponse,
  diagramResponseSchema,
  fileContentResponseSchema,
  filesResponseSchema,
  type DiagramResponse,
  renameEntryResponseSchema,
  type RenameEntryRequest,
  type RenameEntryResponse,
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

/** Отправка JSON-тела методами с полезной нагрузкой (PUT/POST). */
async function sendJson<T>(
  method: 'PUT' | 'POST',
  path: string,
  body: unknown,
  schema: ResponseSchema<T>,
): Promise<T> {
  return request(path, schema, {
    method,
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
    sendJson('PUT', fileUrl(relativePath), payload, saveFileResponseSchema),
  // REQ-08: неперезаписывающее создание нового .c4 файла в существующем каталоге.
  createFile: (payload: CreateFileRequest): Promise<CreateFileResponse> =>
    sendJson('POST', '/api/files', payload, createFileResponseSchema),
  // REQ-09: создание одного нового каталога в существующем parent directory.
  createDirectory: (
    payload: CreateDirectoryRequest,
  ): Promise<CreateDirectoryResponse> =>
    sendJson('POST', '/api/directories', payload, createDirectoryResponseSchema),
  // REQ-10: переименование записи в её каталоге; ответ — entry нового пути.
  renameEntry: (payload: RenameEntryRequest): Promise<RenameEntryResponse> =>
    sendJson('POST', '/api/rename', payload, renameEntryResponseSchema),
  getDiagram: (): Promise<DiagramResponse> =>
    request('/api/diagram', diagramResponseSchema),
}
