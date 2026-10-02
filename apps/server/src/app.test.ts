import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalWorkspaceProvider } from './adapters/local-workspace.js'
import { buildApp } from './app.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const staticRoot = path.resolve(currentDirectory, '../test-fixtures')

const createdDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

async function buildConfiguredApp() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'architecture-'))
  createdDirectories.push(workspaceRoot)

  const app = await buildApp({
    staticRoot,
    workspace: new LocalWorkspaceProvider(workspaceRoot),
  })
  return { app, workspaceRoot }
}

describe('REQ-02 API', () => {
  it('exposes only safe workspace details', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()

    try {
      const [health, workspace, diagram] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/health' }),
        app.inject({ method: 'GET', url: '/api/workspace' }),
        app.inject({ method: 'GET', url: '/api/diagram' }),
      ])

      expect(health.json()).toEqual({ ok: true })
      expect(workspace.json()).toEqual({
        status: 'ready',
        displayName: path.basename(workspaceRoot),
      })
      expect(diagram.json()).toEqual({
        status: 'empty',
        reason: 'NO_WORKSPACE_VIEW',
      })
      expect(JSON.stringify(workspace.json())).not.toContain(workspaceRoot)
      expect(JSON.stringify(workspace.json())).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('ignores any attempt to select another workspace via query', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()

    try {
      const [withPath, withRoot] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/workspace?path=/etc/passwd' }),
        app.inject({ method: 'GET', url: '/api/workspace?root=/etc' }),
      ])

      expect(withPath.json()).toEqual({
        status: 'ready',
        displayName: path.basename(workspaceRoot),
      })
      expect(withRoot.json()).toEqual(withPath.json())
      expect(JSON.stringify(withPath.json())).not.toContain('/etc')
    } finally {
      await app.close()
    }
  })

  it('serves the browser application from the root route', async () => {
    const { app } = await buildConfiguredApp()

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
    const { app } = await buildConfiguredApp()

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

describe('REQ-04 API', () => {
  async function buildAppWithProject() {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await mkdir(path.join(workspaceRoot, 'model'))
    await writeFile(path.join(workspaceRoot, 'likec4.config.json'), '{}', 'utf8')
    await writeFile(path.join(workspaceRoot, 'model/spec.c4'), '', 'utf8')
    return { app, workspaceRoot }
  }

  it('returns the nested tree of allowed files with workspace-relative paths', async () => {
    const { app, workspaceRoot } = await buildAppWithProject()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/files' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        items: [
          { path: 'model', name: 'model', kind: 'directory' },
          { path: 'model/spec.c4', name: 'spec.c4', kind: 'file', language: 'likec4' },
          {
            path: 'likec4.config.json',
            name: 'likec4.config.json',
            kind: 'file',
            language: 'config',
          },
        ],
      })
      expect(JSON.stringify(response.json())).not.toContain(workspaceRoot)
      expect(JSON.stringify(response.json())).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('ignores query parameters, including traversal attempts', async () => {
    const { app } = await buildAppWithProject()

    try {
      const [plain, withPath, withRoot] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/files' }),
        app.inject({ method: 'GET', url: '/api/files?path=../../etc' }),
        app.inject({ method: 'GET', url: '/api/files?root=/etc' }),
      ])

      expect(withPath.json()).toEqual(plain.json())
      expect(withRoot.json()).toEqual(plain.json())
      expect(JSON.stringify(withPath.json())).not.toContain('/etc/')
    } finally {
      await app.close()
    }
  })

  it('returns an understandable empty tree for an empty workspace', async () => {
    const { app } = await buildConfiguredApp()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/files' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ items: [] })
    } finally {
      await app.close()
    }
  })
})
