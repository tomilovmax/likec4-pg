import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_PATH',
  'PATH_OUTSIDE_WORKSPACE',
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

export const diagramResponseSchema = z.object({
  status: z.enum(['empty', 'ready']),
  reason: z.string().optional(),
})

export type DiagramResponse = z.infer<typeof diagramResponseSchema>
