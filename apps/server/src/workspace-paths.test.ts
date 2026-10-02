import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalWorkspaceProvider } from './adapters/local-workspace.js'
import { buildApp } from './app.js'
import { WorkspacePathResolver } from './workspace-paths.js'

const createdDirectories: string[] = []

interface WorkspaceFixture {
  /** Каталог workspace: доверенный корень resolver'а. */
  root: string
  /** Каталог вне workspace с файлом, на который указывают symlink'ы. */
  outside: string
  outsideFile: string
}

async function workspaceFixture(): Promise<WorkspaceFixture> {
  const area = await mkdtemp(path.join(tmpdir(), 'likec4-req03-'))
  createdDirectories.push(area)

  const root = path.join(area, 'workspace')
  const outside = path.join(area, 'outside')
  await mkdir(path.join(root, 'model'), { recursive: true })
  await mkdir(outside, { recursive: true })

  const outsideFile = path.join(outside, 'secret.txt')
  await writeFile(path.join(root, 'model', 'spec.c4'), 'specification {\n}\n')
  await writeFile(path.join(root, 'inner-target.txt'), 'inner')
  await writeFile(outsideFile, 'host secret')

  await symlink(path.join(root, 'model'), path.join(root, 'alias'))
  await symlink(outside, path.join(root, 'escape'))
  await symlink(outsideFile, path.join(root, 'escape-file'))

  return { root, outside, outsideFile }
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject')
    },
    (error: unknown) => error,
  )
}

describe('REQ-03 workspace path resolver', () => {
  it('resolves an existing relative file inside the workspace', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    const resolved = await resolver.resolveExisting('model/spec.c4')

    expect(resolved.relativePath).toBe('model/spec.c4')
    expect(resolved.absolutePath).toBe(path.join(root, 'model', 'spec.c4'))
  })

  it('serves every file operation kind through one resolver instance', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    // list обходится от доверенного корня внутри provider (REQ-04), клиентский
    // путь не участвует. Остальные операции резолвятся так:
    const read = await resolver.resolveExisting('model/spec.c4') // read
    const renameSource = await resolver.resolveExisting('model/spec.c4') // delete, rename source
    const write = await resolver.resolveChild('model/spec.c4') // write (перезапись)
    const createFile = await resolver.resolveChild('model/new.c4') // create
    const createDirectory = await resolver.resolveChild('model/nested') // mkdir
    const renameDestination = await resolver.resolveChild('model/renamed.c4') // rename destination

    expect(read.relativePath).toBe('model/spec.c4')
    expect(renameSource.relativePath).toBe('model/spec.c4')
    expect(write.relativePath).toBe('model/spec.c4')
    expect(createFile.relativePath).toBe('model/new.c4')
    expect(createDirectory.relativePath).toBe('model/nested')
    expect(renameDestination.relativePath).toBe('model/renamed.c4')
  })

  it('rejects ../ traversal with a 4xx error', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    const error = (await rejectionOf(
      resolver.resolveExisting('../../etc/passwd'),
    )) as { statusCode?: number; code?: string }

    expect(error).toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it('rejects traversal hidden deeper in the path', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    await expect(
      resolver.resolveExisting('model/../../outside/secret.txt'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' })
    await expect(resolver.resolveChild('model/../../../etc')).rejects.toMatchObject(
      { code: 'PATH_OUTSIDE_WORKSPACE' },
    )
  })

  it('rejects absolute paths in posix and windows forms', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    for (const userPath of [
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\secret.txt',
    ]) {
      await expect(resolver.resolveExisting(userPath)).rejects.toMatchObject({
        statusCode: 403,
        code: 'PATH_OUTSIDE_WORKSPACE',
      })
      await expect(resolver.resolveChild(userPath)).rejects.toMatchObject({
        statusCode: 403,
        code: 'PATH_OUTSIDE_WORKSPACE',
      })
    }
  })

  it('rejects malformed paths: empty, whitespace, NUL, backslash, root itself', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    for (const userPath of ['', '   ', 'a\0b', 'a\\b', '.']) {
      await expect(resolver.resolveExisting(userPath)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PATH',
      })
      await expect(resolver.resolveChild(userPath)).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PATH',
      })
    }
  })

  it('checks the URL-decoded value, so encoded traversal is rejected', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    // Fastify передаёт параметры уже декодированными — guard видит именно это значение.
    const decoded = decodeURIComponent('%2e%2e/%2e%2e/etc/passwd')
    expect(decoded).toBe('../../etc/passwd')
    await expect(resolver.resolveExisting(decoded)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })

    // Двойное кодирование не становится traversal: остаётся литеральным именем.
    await expect(resolver.resolveExisting('%2e%2e/etc/passwd')).rejects.toMatchObject(
      { statusCode: 404, code: 'NOT_FOUND' },
    )
  })

  it('rejects symlinks pointing outside the root for existing and created entries', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    // Существующая цель (read/delete/rename source).
    await expect(resolver.resolveExisting('escape/secret.txt')).rejects.toMatchObject(
      { statusCode: 403, code: 'PATH_OUTSIDE_WORKSPACE' },
    )
    await expect(resolver.resolveExisting('escape')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await expect(resolver.resolveExisting('escape-file')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })

    // Создаваемая цель (write/create/mkdir/rename destination): parent и уже
    // существующая запись проверяются по realpath. Parent обязан существовать,
    // поэтому проверяем symlink-каталог как parent.
    await expect(resolver.resolveChild('escape/new.c4')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
    await expect(resolver.resolveChild('escape-file')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })

  it('allows internal symlinks and reports their real relative paths', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    const existing = await resolver.resolveExisting('alias/spec.c4')
    expect(existing.relativePath).toBe('model/spec.c4')
    expect(existing.absolutePath).toBe(path.join(root, 'model', 'spec.c4'))

    const created = await resolver.resolveChild('alias/new.c4')
    expect(created.relativePath).toBe('model/new.c4')
    expect(created.absolutePath).toBe(path.join(root, 'model', 'new.c4'))
  })

  it('maps missing entries and missing parents to 404', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    await expect(resolver.resolveExisting('missing.c4')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
    await expect(
      resolver.resolveChild('missing-dir/new.c4'),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  it('does not leak host paths in error messages', async () => {
    const { root, outside, outsideFile } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)

    const traversal = (await rejectionOf(
      resolver.resolveExisting('../../etc/passwd'),
    )) as Error
    const symlinkEscape = (await rejectionOf(
      resolver.resolveExisting('escape/secret.txt'),
    )) as Error

    for (const error of [traversal, symlinkEscape]) {
      expect(error.message).not.toContain(root)
      expect(error.message).not.toContain(outside)
      expect(error.message).not.toContain(outsideFile)
      expect(error.message).not.toContain(tmpdir())
    }
    // Сообщение называет только путь, присланный клиентом.
    expect(traversal.message).toContain('../../etc/passwd')
  })

  it('confines against the real root when the configured root is itself a symlink', async () => {
    const area = await mkdtemp(path.join(tmpdir(), 'likec4-req03-realroot-'))
    createdDirectories.push(area)

    const realRoot = path.join(area, 'real-workspace')
    const outside = path.join(area, 'host-area')
    await mkdir(realRoot)
    await mkdir(outside)
    await writeFile(path.join(realRoot, 'spec.c4'), 'specification {\n}\n')
    await symlink(outside, path.join(realRoot, 'escape'))
    const configuredRoot = path.join(area, 'configured-workspace')
    await symlink(realRoot, configuredRoot)

    const resolver = new WorkspacePathResolver(configuredRoot)

    const resolved = await resolver.resolveExisting('spec.c4')
    expect(resolved.absolutePath).toBe(path.join(realRoot, 'spec.c4'))
    expect(resolved.relativePath).toBe('spec.c4')

    // Симлинк внутри реального корня, ведущий наружу, по-прежнему отклоняется.
    await expect(resolver.resolveExisting('escape')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })
})

describe('REQ-03 guard-to-HTTP mapping', () => {
  // Прокси-маршрут замещает файловые endpoint'ы REQ-04+ до их появления:
  // тот же guard и тот же production error handler, что будут у реальных маршрутов.
  async function buildGuardedApp(root: string) {
    const resolver = new WorkspacePathResolver(root)
    const app = await buildApp({ workspace: new LocalWorkspaceProvider(root) })
    app.get('/api/path-guard', async (request) => {
      const userPath = (request.query as { path?: string }).path ?? ''
      const resolved = await resolver.resolveExisting(userPath)
      return { relativePath: resolved.relativePath }
    })
    return app
  }

  it('answers 4xx through the shared error envelope for plain and URL-encoded traversal', async () => {
    const { root } = await workspaceFixture()
    const app = await buildGuardedApp(root)

    try {
      // Query-значения Fastify передаёт декодированными: guard видит '..' и отклоняет.
      const [encoded, plain] = await Promise.all([
        app.inject({
          method: 'GET',
          url: '/api/path-guard?path=%2e%2e/%2e%2e/etc/passwd',
        }),
        app.inject({
          method: 'GET',
          url: '/api/path-guard?path=../../etc/passwd',
        }),
      ])

      expect(encoded.statusCode).toBe(403)
      expect(plain.statusCode).toBe(403)
      expect(encoded.json()).toMatchObject({
        error: { code: 'PATH_OUTSIDE_WORKSPACE' },
      })
      expect(plain.json()).toMatchObject({
        error: { code: 'PATH_OUTSIDE_WORKSPACE' },
      })

      const payload = `${encoded.body}${plain.body}`
      expect(payload).not.toContain(root)
      expect(payload).not.toContain(tmpdir())
    } finally {
      await app.close()
    }
  })

  it('lets a valid relative path through the guarded route', async () => {
    const { root } = await workspaceFixture()
    const app = await buildGuardedApp(root)

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/path-guard?path=model/spec.c4',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ relativePath: 'model/spec.c4' })
    } finally {
      await app.close()
    }
  })

  it('answers 4xx for encoded traversal that reaches the guard undecoded', async () => {
    const { root } = await workspaceFixture()
    const resolver = new WorkspacePathResolver(root)
    const app = await buildApp({ workspace: new LocalWorkspaceProvider(root) })
    // Wildcard-параметр Fastify не декодирует: '%2e%2e' остаётся литеральным
    // именем и не может стать traversal — итог всё равно 4xx, не escape.
    app.get('/api/path-guard/*', async (request) => {
      const resolved = await resolver.resolveExisting(
        request.params['*'] as string,
      )
      return { relativePath: resolved.relativePath }
    })

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/path-guard/%2e%2e/%2e%2e/etc/passwd',
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
      expect(response.body).not.toContain(root)
    } finally {
      await app.close()
    }
  })
})
