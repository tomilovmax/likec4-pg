import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildApp } from './app.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const staticRoot = path.resolve(currentDirectory, '../test-fixtures')

describe('REQ-01 API', () => {
  it('returns safe initial panel resources', async () => {
    const app = await buildApp()

    try {
      const [health, workspace, files, diagram] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/health' }),
        app.inject({ method: 'GET', url: '/api/workspace?path=/etc/passwd' }),
        app.inject({ method: 'GET', url: '/api/files' }),
        app.inject({ method: 'GET', url: '/api/diagram' }),
      ])

      expect(health.json()).toEqual({ ok: true })
      expect(workspace.json()).toEqual({
        status: 'unconfigured',
        displayName: 'Workspace',
      })
      expect(files.json()).toEqual({ items: [] })
      expect(diagram.json()).toEqual({
        status: 'empty',
        reason: 'NO_WORKSPACE_VIEW',
      })
      expect(JSON.stringify(workspace.json())).not.toContain('/etc/passwd')
    } finally {
      await app.close()
    }
  })

  it('serves the browser application from the root route', async () => {
    const app = await buildApp({ staticRoot })

    try {
      const response = await app.inject({ method: 'GET', url: '/' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('Web IDE fixture')
    } finally {
      await app.close()
    }
  })

  it('uses the common error envelope for unknown routes', async () => {
    const app = await buildApp()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/missing' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      })
    } finally {
      await app.close()
    }
  })
})
