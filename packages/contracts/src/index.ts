import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_PATH',
  'PATH_OUTSIDE_WORKSPACE',
  'UNSUPPORTED_FILE',
  // REQ-07: version token сохранения не совпал с текущим содержимым файла.
  'CONFLICT',
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

// REQ-07: атомарное сохранение с проверкой version token. client →
// PUT /api/files/* { content, version }; успешный ответ — FileContentResponse
// с новой версией (тот же контракт, что у чтения).
export const saveFileRequestSchema = z.object({
  content: z.string(),
  version: z.string().length(64),
})
export type SaveFileRequest = z.infer<typeof saveFileRequestSchema>

// Успешный ответ сохранения — то же представление, что у чтения: normalized
// path, язык, literal content и новая version token.
export const saveFileResponseSchema = fileContentResponseSchema
export type SaveFileResponse = FileContentResponse

// REQ-08: создание нового .c4 файла. client → POST /api/files { parent, name };
// `parent` — workspace-относительный путь существующего каталога ('' — корень
// workspace), `name` — базовое имя создаваемого файла. Backend создаёт только
// .c4 и никогда не перезаписывает существующую запись.
export const createFileRequestSchema = z.object({
  parent: z.string(),
  name: z.string(),
})
export type CreateFileRequest = z.infer<typeof createFileRequestSchema>

// Успешный ответ — то же представление, что у чтения: новый пустой файл уже
// можно открыть в редакторе без дополнительного запроса.
export const createFileResponseSchema = fileContentResponseSchema
export type CreateFileResponse = FileContentResponse

export type FileContentResponse = z.infer<typeof fileContentResponseSchema>

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

// REQ-15: layouted-модель для официального renderer'а likec4/react (субпаф
// likec4@1.59.4). Модель — opaque JSON ($data из layoutedModel()): структурную
// целостность гарантирует пара LikeC4Model.create() + ReactLikeC4 на клиенте,
// поэтому zod проверяет только конверт — зеркало полной схемы $data было бы
// ручной привязкой к внутреннему формату upstream, ломающейся на любом
// minor-обновлении.
export type DiagramModelData = {
  _stage: 'layouted'
  projectId: string
  views: Record<string, unknown>
}

export const diagramModelDataSchema = z.custom<DiagramModelData>((value) => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const model = value as Record<string, unknown>
  return (
    model['_stage'] === 'layouted' &&
    typeof model['projectId'] === 'string' &&
    typeof model['views'] === 'object' &&
    model['views'] !== null
  )
})

export const diagramResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    model: diagramModelDataSchema,
    views: z.array(projectViewSchema),
    defaultViewId: z.string(),
  }),
  z.object({
    status: z.literal('empty'),
    reason: z.string().optional(),
  }),
  z.object({
    status: z.literal('invalid'),
    diagnostics: z.array(projectDiagnosticSchema),
  }),
])

export type DiagramResponse = z.infer<typeof diagramResponseSchema>
