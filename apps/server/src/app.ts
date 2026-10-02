import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'

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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
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
  // REQ-05: чтение файла по workspace-относительному пути. Wildcard-параметр
  // приходит от Fastify уже URL-decoded и уходит в общий path guard REQ-03.
  app.get<{ Params: { '*': string } }>('/api/files/*', async (request, reply) => {
    const content = await workspace.readFile(request.params['*'])
    // Strong ETag с тем же token, что в теле: база для optimistic save (REQ-07).
    reply.header('etag', `"${content.version}"`)
    reply.header('cache-control', 'no-store')
    return content
  })
  // REQ-14: полная multi-file LikeC4 model официальным API upstream;
  // без path-параметров — parsing context всегда весь workspace.
  app.get('/api/project', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return await workspace.getProject()
  })
  app.get('/api/diagram', () => workspace.getDiagram())

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      wildcard: false,
    })
  }

  return app
}
