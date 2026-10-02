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

describe('REQ-05 API', () => {
  // Буквальный текст: комментарий, CRLF, unicode, нет trailing newline —
  // ничего из этого не должно измениться при открытии.
  const literalContent =
    '// комментарий сохраняется буквально\r\nmodel {\r\n  demo = "λ-α"\r\n}\r\n// конца строки в конце нет'

  async function buildAppWithSourceFile() {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await mkdir(path.join(workspaceRoot, 'model'))
    await writeFile(path.join(workspaceRoot, 'model/spec.c4'), literalContent, 'utf8')
    return { app, workspaceRoot }
  }

  it('returns literal UTF-8 content with a stable version token and ETag', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()

    try {
      const [plain, encodedSlash] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/files/model/spec.c4' }),
        app.inject({ method: 'GET', url: '/api/files/model%2Fspec.c4' }),
      ])

      for (const response of [plain, encodedSlash]) {
        expect(response.statusCode).toBe(200)
        const body = response.json()
        expect(body).toEqual({
          path: 'model/spec.c4',
          name: 'spec.c4',
          language: 'likec4',
          content: literalContent,
          version: plain.json().version,
        })
        // Version token стабилен для одинакового содержимого и отдаётся
        // также strong ETag’ом для последующего optimistic save.
        expect(body.version).toMatch(/^[0-9a-f]{64}$/)
        expect(response.headers.etag).toBe(`"${body.version}"`)
        expect(JSON.stringify(body)).not.toContain(workspaceRoot)
        expect(JSON.stringify(body)).not.toContain(tmpdir())
      }
    } finally {
      await app.close()
    }
  })

  it('changes the version token when the file content changes', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()

    try {
      const before = (await app.inject({ method: 'GET', url: '/api/files/model/spec.c4' })).json()
        .version as string
      await writeFile(path.join(workspaceRoot, 'model/spec.c4'), 'model {}\n', 'utf8')
      const after = (await app.inject({ method: 'GET', url: '/api/files/model/spec.c4' })).json()
        .version as string

      expect(after).toMatch(/^[0-9a-f]{64}$/)
      expect(after).not.toBe(before)
    } finally {
      await app.close()
    }
  })

  it('gives 404 for a missing file and keeps the common error envelope', async () => {
    const { app } = await buildAppWithSourceFile()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/files/model/missing.c4' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Entry not found in the workspace.',
        },
      })
    } finally {
      await app.close()
    }
  })

  it('rejects traversal paths, including URL-encoded ones', async () => {
    const { app } = await buildAppWithSourceFile()

    try {
      // Literal `..` схлопывается router’ом до отсутствующего маршрута (404),
      // URL-encoded варианты доходят до resolver’а и отклоняются guard’ом.
      const [plain, encoded, absolute] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/files/../outside.c4' }),
        app.inject({ method: 'GET', url: '/api/files/..%2F..%2F..%2Fetc%2Fpasswd' }),
        app.inject({ method: 'GET', url: '/api/files/%2Fetc%2Fpasswd' }),
      ])

      expect(plain.statusCode).toBe(404)
      for (const response of [encoded, absolute]) {
        expect(response.statusCode).toBe(403)
        expect(response.json().error.code).toBe('PATH_OUTSIDE_WORKSPACE')
      }
      for (const response of [plain, encoded, absolute]) {
        // Ни один вариант не отдаёт содержимое и не раскрывает пути хоста.
        expect(response.statusCode).toBeGreaterThanOrEqual(400)
        expect(response.body).not.toContain('root:')
      }
    } finally {
      await app.close()
    }
  })

  it('refuses disallowed, binary and non-UTF-8 files as editable text', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await writeFile(path.join(workspaceRoot, 'README.md'), 'not likec4', 'utf8')
    await writeFile(path.join(workspaceRoot, 'image.c4'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))
    await writeFile(path.join(workspaceRoot, 'broken.c4'), Buffer.from([0x61, 0xff, 0x0a]))

    try {
      const [disallowed, binary, invalidUtf8] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/files/README.md' }),
        app.inject({ method: 'GET', url: '/api/files/image.c4' }),
        app.inject({ method: 'GET', url: '/api/files/broken.c4' }),
      ])

      for (const response of [disallowed, binary, invalidUtf8]) {
        expect(response.statusCode).toBe(415)
        expect(response.json().error.code).toBe('UNSUPPORTED_FILE')
      }
      expect(binary.json().error.message).toContain('binary')
    } finally {
      await app.close()
    }
  })

  it('refuses a directory even when its name looks like a source file', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await mkdir(path.join(workspaceRoot, 'sources.c4'))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/files/sources.c4' })

      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe('INVALID_PATH')
    } finally {
      await app.close()
    }
  })
})
