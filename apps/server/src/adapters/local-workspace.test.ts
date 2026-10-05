import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalWorkspaceProvider } from './local-workspace.js'

const createdDirectories: string[] = []

async function temporaryWorkspace(name = 'architecture'): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'likec4-req02-'))
  createdDirectories.push(parent)
  const workspaceRoot = path.join(parent, name)
  await mkdir(workspaceRoot)
  return workspaceRoot
}

/** Внешний по отношению к workspace файл — цель symlink «наружу». */
async function fileOutsideWorkspace(name: string, content = 'external'): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'likec4-outside-'))
  createdDirectories.push(parent)
  const filePath = path.join(parent, name)
  await writeFile(filePath, content, 'utf8')
  return filePath
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('REQ-02 local workspace provider', () => {
  it('reports a ready workspace with a safe display name', async () => {
    const workspaceRoot = await temporaryWorkspace('architecture')

    const provider = new LocalWorkspaceProvider(workspaceRoot)
    const response = await provider.getWorkspace()

    expect(response).toEqual({
      status: 'ready',
      displayName: 'architecture',
    })
    expect(JSON.stringify(response)).not.toContain(workspaceRoot)
  })

  it('falls back to a neutral display name for the filesystem root', async () => {
    const provider = new LocalWorkspaceProvider('/')

    expect(await provider.getWorkspace()).toEqual({
      status: 'ready',
      displayName: 'workspace',
    })
  })

  it('returns an empty diagram state for a workspace without views', async () => {
    const provider = new LocalWorkspaceProvider(await temporaryWorkspace())

    expect(await provider.getDiagram()).toEqual({
      status: 'empty',
      reason: 'NO_VIEWS',
    })
  })
})

describe('REQ-04 workspace file tree', () => {
  it('lists nested allowed files with directories first and relative paths only', async () => {
    const workspaceRoot = await temporaryWorkspace()
    await writeFile(path.join(workspaceRoot, 'likec4.config.json'), '{}', 'utf8')
    await writeFile(path.join(workspaceRoot, 'example.c4'), 'model {}', 'utf8')
    await mkdir(path.join(workspaceRoot, 'model'))
    await writeFile(path.join(workspaceRoot, 'model/specification.c4'), '', 'utf8')
    await writeFile(path.join(workspaceRoot, 'model/relations.likec4'), '', 'utf8')
    await mkdir(path.join(workspaceRoot, 'views'))
    await writeFile(path.join(workspaceRoot, 'views/overview.c4'), '', 'utf8')
    // Нерелевантное содержимое: бинарные файлы, документы и скрытые каталоги.
    await mkdir(path.join(workspaceRoot, 'assets'))
    await writeFile(path.join(workspaceRoot, 'assets/logo.png'), 'binary-placeholder', 'utf8')
    await mkdir(path.join(workspaceRoot, 'docs'))
    await writeFile(path.join(workspaceRoot, 'docs/README.md'), 'readme', 'utf8')
    await mkdir(path.join(workspaceRoot, '.git'))
    await writeFile(path.join(workspaceRoot, '.git/hidden.c4'), '', 'utf8')

    const response = await new LocalWorkspaceProvider(workspaceRoot).listFiles()

    expect(response).toEqual({
      items: [
        { path: 'model', name: 'model', kind: 'directory' },
        {
          path: 'model/relations.likec4',
          name: 'relations.likec4',
          kind: 'file',
          language: 'likec4',
        },
        {
          path: 'model/specification.c4',
          name: 'specification.c4',
          kind: 'file',
          language: 'likec4',
        },
        { path: 'views', name: 'views', kind: 'directory' },
        {
          path: 'views/overview.c4',
          name: 'overview.c4',
          kind: 'file',
          language: 'likec4',
        },
        {
          path: 'example.c4',
          name: 'example.c4',
          kind: 'file',
          language: 'likec4',
        },
        {
          path: 'likec4.config.json',
          name: 'likec4.config.json',
          kind: 'file',
          language: 'config',
        },
      ],
    })
    expect(JSON.stringify(response)).not.toContain(workspaceRoot)
    expect(JSON.stringify(response)).not.toContain(tmpdir())
  })

  it('allows internal symlinks but never lists entries outside the workspace', async () => {
    const workspaceRoot = await temporaryWorkspace()
    await writeFile(path.join(workspaceRoot, 'example.c4'), 'model {}', 'utf8')
    await mkdir(path.join(workspaceRoot, 'internal'))
    await writeFile(path.join(workspaceRoot, 'internal/nested.c4'), '', 'utf8')

    const externalFile = await fileOutsideWorkspace('secret.c4')
    const externalDirectory = path.dirname(externalFile)

    await symlink('example.c4', path.join(workspaceRoot, 'linked.c4'))
    await symlink(externalFile, path.join(workspaceRoot, 'escape.c4'))
    await symlink(
      externalDirectory,
      path.join(workspaceRoot, 'escape-directory'),
    )
    await symlink(
      workspaceRoot,
      path.join(workspaceRoot, 'self'),
    )

    const response = await new LocalWorkspaceProvider(workspaceRoot).listFiles()

    const paths = response.items.map((item) => item.path)
    expect(paths).toContain('linked.c4')
    expect(paths).toContain('internal')
    expect(paths).toContain('internal/nested.c4')
    expect(paths).not.toContain('escape.c4')
    expect(paths).not.toContain('escape-directory')
    // Ссылка на сам workspace уже посещена и не порождает дубликатов.
    expect(paths).not.toContain('self')
    expect(JSON.stringify(response)).not.toContain(externalFile)
  })

  it('returns an empty tree for an empty workspace', async () => {
    const provider = new LocalWorkspaceProvider(await temporaryWorkspace())

    expect(await provider.listFiles()).toEqual({ items: [] })
  })
})

describe('REQ-05 file content', () => {
  it('returns literal content, language and a content-derived version', async () => {
    const workspaceRoot = await temporaryWorkspace()
    const content = '// заметка\r\nmodel {}\r\n'
    await writeFile(path.join(workspaceRoot, 'relations.likec4'), content, 'utf8')
    await writeFile(path.join(workspaceRoot, 'likec4.config.json'), '{ "name": "demo" }', 'utf8')

    const provider = new LocalWorkspaceProvider(workspaceRoot)
    const [source, config, sourceAgain] = await Promise.all([
      provider.readFile('relations.likec4'),
      provider.readFile('likec4.config.json'),
      provider.readFile('relations.likec4'),
    ])

    expect(source.content).toBe(content)
    expect(source.language).toBe('likec4')
    expect(source.path).toBe('relations.likec4')
    // Версия стабильна для одинакового содержимого.
    expect(sourceAgain.version).toBe(source.version)
    expect(source.version).toMatch(/^[0-9a-f]{64}$/)
    expect(config.language).toBe('config')
    expect(JSON.stringify(source)).not.toContain(workspaceRoot)
  })

  it('reads an internal symlink by its real relative path', async () => {
    const workspaceRoot = await temporaryWorkspace()
    await mkdir(path.join(workspaceRoot, 'model'))
    await writeFile(path.join(workspaceRoot, 'model/spec.c4'), 'model {}', 'utf8')
    await symlink('model/spec.c4', path.join(workspaceRoot, 'spec-link.c4'))

    const response = await new LocalWorkspaceProvider(workspaceRoot).readFile('spec-link.c4')

    expect(response.content).toBe('model {}')
    expect(response.path).toBe('model/spec.c4')
    expect(response.name).toBe('spec.c4')
  })

  it('refuses to read through a symlink outside the workspace', async () => {
    const workspaceRoot = await temporaryWorkspace()
    const externalFile = await fileOutsideWorkspace('secret.c4', 'secret')
    await symlink(externalFile, path.join(workspaceRoot, 'escape.c4'))

    await expect(
      new LocalWorkspaceProvider(workspaceRoot).readFile('escape.c4'),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'PATH_OUTSIDE_WORKSPACE',
    })
  })
})
