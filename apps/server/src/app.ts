import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

import { createFileRequestSchema, saveFileRequestSchema } from '@likec4-web-ide/contracts'

import type { WorkspacePort } from './domain/workspace-port.js'
import { ApiError } from './http/api-error.js'

export interface BuildAppOptions {
  staticRoot?: string
  workspace: WorkspacePort
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const workspace = options.workspace

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    // REQ-07: синтаксически битый JSON доходит сюда как ошибка Fastify content-type
    // parser'а с statusCode 400 — приводим её к общему envelope вместо 500.
    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
        },
      })
    }

    app.log.error(error)
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
      },
    })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    }),
  )

  app.get('/api/health', async () => ({ ok: true }))
  app.get('/api/workspace', () => workspace.getWorkspace())
  app.get('/api/files', () => workspace.listFiles())
  // REQ-08: создание нового .c4 файла. Parent и имя идут телом JSON — путь
  // не проходит через URL-декодирование router’а, а резолвится общим guard’ом
  // REQ-03 внутри createFile. Успех — 201 с FileContentResponse пустого файла.
  app.post('/api/files', async (request, reply) => {
    const parsed = createFileRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Invalid create file request body',
      )
    }
    const created = await workspace.createFile(parsed.data.parent, parsed.data.name)
    reply.header('etag', `"${created.version}"`)
    reply.header('cache-control', 'no-store')
    reply.status(201)
    return created
  })
  // REQ-05: чтение файла по workspace-относительному пути. Wildcard-параметр
  // приходит от Fastify уже URL-decoded и уходит в общий path guard REQ-03.
  app.get<{ Params: { '*': string } }>('/api/files/*', async (request, reply) => {
    const content = await workspace.readFile(request.params['*'])
    // Strong ETag с тем же token, что в теле: база для optimistic save (REQ-07).
    reply.header('etag', `"${content.version}"`)
    reply.header('cache-control', 'no-store')
    return content
  })

  // REQ-07: атомарное сохранение literal buffer с проверкой version token.
  // Payload { content, version }, ответ — FileContentResponse с новой версией.
  app.put<{ Params: { '*': string } }>(
    '/api/files/*',
    async (request, reply) => {
      const parsed = saveFileRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Invalid save request body',
        )
      }
      const { content, version } = parsed.data
      const saved = await workspace.saveFile(request.params['*'], content, version)
      reply.header('etag', `"${saved.version}"`)
      reply.header('cache-control', 'no-store')
      reply.status(200)
      return saved
    },
  )
  // REQ-14: полная multi-file LikeC4 model официальным API upstream;
  // без path-параметров — parsing context всегда весь workspace.
  app.get('/api/project', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return await workspace.getProject()
  })
  // REQ-15: layouted-модель для Diagram panel; no-store — модель меняется с
  // каждым сохранением (reparse — REQ-17).
  app.get('/api/diagram', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return await workspace.getDiagram()
  })

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      wildcard: false,
    })
  }

  return app
}
