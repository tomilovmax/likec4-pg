import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'

import { EmptyWorkspaceProvider } from './adapters/empty-workspace.js'
import { ApiError } from './http/api-error.js'
import type { WorkspacePort } from './domain/workspace-port.js'

export interface BuildAppOptions {
  staticRoot?: string
  workspace?: WorkspacePort
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const workspace = options.workspace ?? new EmptyWorkspaceProvider()

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
  app.get('/api/diagram', () => workspace.getDiagram())

  if (options.staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticRoot,
      wildcard: false,
    })
  }

  return app
}
