import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_PATH',
  'PATH_OUTSIDE_WORKSPACE',
  'UNSUPPORTED_FILE',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const healthResponseSchema = z.object({
  ok: z.literal(true),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export const workspaceResponseSchema = z.object({
  status: z.enum(['ready']),
  displayName: z.string(),
})

export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>

export const fileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(['file', 'directory']),
  language: z.enum(['likec4', 'config']).optional(),
})

export const filesResponseSchema = z.object({
  items: z.array(fileEntrySchema),
})

export type FileEntry = z.infer<typeof fileEntrySchema>
export type FilesResponse = z.infer<typeof filesResponseSchema>

// REQ-05: буквальный UTF-8 текст разрешённого файла и стабильный version
// token текущего содержимого (sha256 от байтов) для последующего optimistic
// save (REQ-07). Тот же token дублируется заголовком ETag.
export const fileContentResponseSchema = z.object({
  path: z.string(),
  name: z.string(),
  language: z.enum(['likec4', 'config']),
  content: z.string(),
  version: z.string().length(64),
})

export type FileContentResponse = z.infer<typeof fileContentResponseSchema>

export const diagramResponseSchema = z.object({
  status: z.enum(['empty', 'ready']),
  reason: z.string().optional(),
})

export type DiagramResponse = z.infer<typeof diagramResponseSchema>

// REQ-14: полная multi-file модель проекта, загруженная официальным API LikeC4.
// Ветка «ok» отдаётся только при пустом списке ошибок парсинга: половинную
// модель клиент не получает (основа для REQ-15/18 — preview не выдаёт прежнюю
// диаграмму за актуальную после неудачного reparse).
export const projectViewSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
})

export const projectElementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
})

const projectDiagnosticPositionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
})

export const projectDiagnosticSchema = z.object({
  message: z.string(),
  // Workspace-относительный путь источника; опускается, если файл вне корня
  // (например, диагностика не привязана к документу workspace).
  path: z.string().optional(),
  range: z.object({
    start: projectDiagnosticPositionSchema,
    end: projectDiagnosticPositionSchema,
  }),
})

export const projectResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    views: z.array(projectViewSchema),
    elements: z.array(projectElementSchema),
  }),
  z.object({
    status: z.literal('invalid'),
    diagnostics: z.array(projectDiagnosticSchema),
  }),
])

export type ProjectView = z.infer<typeof projectViewSchema>
export type ProjectElement = z.infer<typeof projectElementSchema>
export type ProjectDiagnostic = z.infer<typeof projectDiagnosticSchema>
export type ProjectResponse = z.infer<typeof projectResponseSchema>
