import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { diagramResponseSchema, projectResponseSchema } from '@likec4-web-ide/contracts'

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

// Multi-file LikeC4-проект: config + specification + model + views, включая
// вложенные каталоги и cross-file references (`extra` в model/extra.c4
// ссылается на `dev` из model.c4; view dev-extra включает оба).
async function buildAppWithMultiFileProject() {
  const { app, workspaceRoot } = await buildConfiguredApp()
  await mkdir(path.join(workspaceRoot, 'model'))
  await mkdir(path.join(workspaceRoot, 'views'))
  const files: Array<[string, string]> = [
    ['likec4.config.json', '{"name":"fixture"}'],
    ['specification.c4', 'specification {\n  element requirement\n  element subsystem\n}\n'],
    ['model.c4', "model {\n  dev = requirement {\n    title 'Dev'\n  }\n  core = subsystem {\n    title 'Core'\n    -> dev 'реализует'\n  }\n}\n"],
    ['model/extra.c4', "model {\n  extra = subsystem {\n    title 'Extra'\n    -> dev 'расширяет'\n  }\n}\n"],
    ['views.c4', "views {\n  view overview {\n    title 'Overview'\n    include *\n  }\n}\n"],
    ['views/extra.c4', "views {\n  view dev-extra {\n    title 'Dev and Extra'\n    include dev, extra\n  }\n}\n"],
  ]
  for (const [relativePath, content] of files) {
    await writeFile(path.join(workspaceRoot, relativePath), content, 'utf8')
  }
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
        reason: 'NO_VIEWS',
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

describe('REQ-07 API', () => {
  // Буквальный текст: комментарий, CRLF, unicode, нет trailing newline —
  // сохраняется побайтно, как и открывается.
  const savedContent =
    '// комментарий сохраняется буквально\r\nmodel {\r\n  demo = "λ-α"\r\n}\r\n// конца строки в конце нет'

  async function buildAppWithSourceFile() {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await mkdir(path.join(workspaceRoot, 'model'))
    await writeFile(path.join(workspaceRoot, 'model/spec.c4'), 'model {}\n', 'utf8')
    return { app, workspaceRoot }
  }

  async function readSourceVersion(app: Awaited<ReturnType<typeof buildConfiguredApp>>['app']) {
    const response = await app.inject({ method: 'GET', url: '/api/files/model/spec.c4' })
    expect(response.statusCode).toBe(200)
    return response.json() as { content: string; version: string }
  }

  it('saves the literal buffer atomically and returns the new version and ETag', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()

    try {
      const opened = await readSourceVersion(app)
      const response = await app.inject({
        method: 'PUT',
        url: '/api/files/model/spec.c4',
        payload: { content: savedContent, version: opened.version },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      const body = response.json()
      expect(body).toEqual({
        path: 'model/spec.c4',
        name: 'spec.c4',
        language: 'likec4',
        content: savedContent,
        version: body.version,
      })
      expect(body.version).toMatch(/^[0-9a-f]{64}$/)
      expect(body.version).not.toBe(opened.version)
      expect(response.headers.etag).toBe(`"${body.version}"`)
      // Файл на диске совпадает побайтно с присланным buffer’ом.
      await expect(readFile(path.join(workspaceRoot, 'model/spec.c4'), 'utf8')).resolves.toBe(
        savedContent,
      )
      expect(JSON.stringify(body)).not.toContain(workspaceRoot)
    } finally {
      await app.close()
    }
  })

  it('updates the version token so the next optimistic save succeeds', async () => {
    const { app } = await buildAppWithSourceFile()

    try {
      const opened = await readSourceVersion(app)
      const first = await app.inject({
        method: 'PUT',
        url: '/api/files/model/spec.c4',
        payload: { content: 'model { first }\n', version: opened.version },
      })
      expect(first.statusCode).toBe(200)

      // Повторное сохранение со свежей версией — конфликтов нет.
      const second = await app.inject({
        method: 'PUT',
        url: '/api/files/model/spec.c4',
        payload: { content: 'model { second }\n', version: first.json().version },
      })
      expect(second.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('gives 409 CONFLICT for a stale version and leaves the file intact', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()

    try {
      const opened = await readSourceVersion(app)
      // Файл меняется вне IDE после открытия.
      await writeFile(path.join(workspaceRoot, 'model/spec.c4'), 'external\n', 'utf8')

      const response = await app.inject({
        method: 'PUT',
        url: '/api/files/model/spec.c4',
        payload: { content: 'model { mine }\n', version: opened.version },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('CONFLICT')
      // Чужая версия не перезаписана, частичной записи нет.
      await expect(readFile(path.join(workspaceRoot, 'model/spec.c4'), 'utf8')).resolves.toBe(
        'external\n',
      )
    } finally {
      await app.close()
    }
  })

  it('rejects traversal, outside symlinks, directories and disallowed names', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()
    await writeFile(path.join(workspaceRoot, 'README.md'), 'not likec4', 'utf8')
    await mkdir(path.join(workspaceRoot, 'sources.c4'))

    try {
      const [encodedTraversal, absolute, directory, disallowed, missing] = await Promise.all([
        app.inject({
          method: 'PUT',
          url: '/api/files/..%2F..%2Fetc%2Fpasswd',
          payload: { content: 'model {}\n', version: 'a'.repeat(64) },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/%2Fetc%2Fpasswd',
          payload: { content: 'model {}\n', version: 'a'.repeat(64) },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/sources.c4',
          payload: { content: 'model {}\n', version: 'a'.repeat(64) },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/README.md',
          payload: { content: 'readme', version: 'a'.repeat(64) },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/model/missing.c4',
          payload: { content: 'model {}\n', version: 'a'.repeat(64) },
        }),
      ])

      expect(encodedTraversal.statusCode).toBe(403)
      expect(encodedTraversal.json().error.code).toBe('PATH_OUTSIDE_WORKSPACE')
      expect(absolute.statusCode).toBe(403)
      expect(directory.statusCode).toBe(400)
      expect(directory.json().error.code).toBe('INVALID_PATH')
      expect(disallowed.statusCode).toBe(415)
      expect(disallowed.json().error.code).toBe('UNSUPPORTED_FILE')
      expect(missing.statusCode).toBe(404)
      // Ничего лишнего не создано и не перезаписано.
      await expect(
        readFile(path.join(workspaceRoot, 'README.md'), 'utf8'),
      ).resolves.toBe('not likec4')
    } finally {
      await app.close()
    }
  })

  it('rejects a malformed save payload without touching the file', async () => {
    const { app, workspaceRoot } = await buildAppWithSourceFile()

    try {
      const opened = await readSourceVersion(app)
      const [noVersion, shortVersion, noContent, emptyBody, badJson] = await Promise.all([
        app.inject({
          method: 'PUT',
          url: '/api/files/model/spec.c4',
          payload: { content: 'model {}\n' },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/model/spec.c4',
          payload: { content: 'model {}\n', version: 'tooshort' },
        }),
        app.inject({
          method: 'PUT',
          url: '/api/files/model/spec.c4',
          payload: { version: opened.version },
        }),
        app.inject({ method: 'PUT', url: '/api/files/model/spec.c4' }),
        // Синтаксически битый JSON отклоняется content-type parser'ом Fastify
        // ещё до хендлера — должен превратиться в общий 400 envelope.
        app.inject({
          method: 'PUT',
          url: '/api/files/model/spec.c4',
          payload: '{invalid json',
          headers: { 'content-type': 'application/json' },
        }),
      ])

      for (const response of [noVersion, shortVersion, noContent, emptyBody, badJson]) {
        expect(response.statusCode).toBe(400)
        expect(response.json().error.code).toBe('VALIDATION_ERROR')
      }
      // Исходное содержимое не тронуто.
      await expect(readFile(path.join(workspaceRoot, 'model/spec.c4'), 'utf8')).resolves.toBe(
        'model {}\n',
      )
    } finally {
      await app.close()
    }
  })
})

describe('REQ-14 API', () => {
  it('returns the whole multi-file model with workspace-relative data only', async () => {
    const { app } = await buildAppWithMultiFileProject()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/project' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      const body = projectResponseSchema.parse(response.json())
      expect(body.status).toBe('ok')
      if (body.status !== 'ok') {
        return
      }
      // Implicit view `index` добавляется версией LikeC4 1.59.4.
      expect(body.views).toEqual([
        { id: 'dev-extra', title: 'Dev and Extra' },
        { id: 'index', title: 'Landscape view' },
        { id: 'overview', title: 'Overview' },
      ])
      expect(body.elements).toEqual([
        { id: 'core', kind: 'subsystem', title: 'Core' },
        { id: 'dev', kind: 'requirement', title: 'Dev' },
        { id: 'extra', kind: 'subsystem', title: 'Extra' },
      ])
      expect(JSON.stringify(body)).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('keeps unopened files in the parsing context after opening a single file', async () => {
    const { app } = await buildAppWithMultiFileProject()

    try {
      const opened = await app.inject({ method: 'GET', url: '/api/files/model.c4' })
      expect(opened.statusCode).toBe(200)

      const project = await app.inject({ method: 'GET', url: '/api/project' })
      const body = projectResponseSchema.parse(project.json())
      expect(body.status).toBe('ok')
      if (body.status !== 'ok') {
        return
      }
      // View и элемент из файлов, которые не открывались, остаются в модели.
      expect(body.views.map((view) => view.id)).toContain('dev-extra')
      expect(body.elements.map((element) => element.id)).toContain('extra')
    } finally {
      await app.close()
    }
  })

  it('reports an invalid project as 200 with diagnostics, not as a transport error', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await writeFile(
      path.join(workspaceRoot, 'broken.c4'),
      'model {\n  missing = nowhere {\n}\n',
      'utf8',
    )

    try {
      const response = await app.inject({ method: 'GET', url: '/api/project' })

      expect(response.statusCode).toBe(200)
      const body = projectResponseSchema.parse(response.json())
      expect(body.status).toBe('invalid')
      if (body.status !== 'invalid') {
        return
      }
      expect(body.diagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(body)).not.toContain(workspaceRoot)
      expect(JSON.stringify(body)).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })
})

describe('REQ-15 API', () => {
  it('returns a ready layouted diagram for the multi-file project', async () => {
    const { app, workspaceRoot } = await buildAppWithMultiFileProject()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/diagram' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      const body = diagramResponseSchema.parse(response.json())
      expect(body.status).toBe('ready')
      if (body.status !== 'ready') {
        return
      }
      // Implicit view `index` добавляется версией LikeC4 1.59.4 и выбирается
      // default view (правило REQ-15; выбор из списка — REQ-16).
      expect(body.defaultViewId).toBe('index')
      expect(body.views.map((view) => view.id)).toEqual(['dev-extra', 'index', 'overview'])
      // Layouted-модель: view из вложенного каталога входит в данные renderer'а.
      expect(body.model._stage).toBe('layouted')
      expect(Object.keys(body.model.views)).toContain('dev-extra')
      expect(JSON.stringify(body)).not.toContain(workspaceRoot)
      expect(JSON.stringify(body)).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('reports an invalid diagram as 200 with diagnostics, not as a transport error', async () => {
    const { app, workspaceRoot } = await buildConfiguredApp()
    await writeFile(
      path.join(workspaceRoot, 'broken.c4'),
      'model {\n  missing = nowhere {\n}\n',
      'utf8',
    )

    try {
      const response = await app.inject({ method: 'GET', url: '/api/diagram' })

      expect(response.statusCode).toBe(200)
      const body = diagramResponseSchema.parse(response.json())
      expect(body.status).toBe('invalid')
      if (body.status !== 'invalid') {
        return
      }
      expect(body.diagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(body)).not.toContain(workspaceRoot)
      expect(JSON.stringify(body)).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('returns an empty state for a workspace without views', async () => {
    const { app } = await buildConfiguredApp()

    try {
      const response = await app.inject({ method: 'GET', url: '/api/diagram' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'empty', reason: 'NO_VIEWS' })
    } finally {
      await app.close()
    }
  })
})
