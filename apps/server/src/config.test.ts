import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_PORT, loadServerConfig, ServerConfigError } from './config.js'

const createdDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'likec4-req02-'))
  createdDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('REQ-02 server config', () => {
  it('accepts an existing readable directory', async () => {
    const workspace = await temporaryDirectory()

    const config = await loadServerConfig({
      LIKEC4_WORKSPACE: workspace,
    })

    expect(config.workspaceRoot).toBe(path.resolve(workspace))
    expect(config.port).toBe(DEFAULT_PORT)
  })

  it('rejects an unset or empty LIKEC4_WORKSPACE', async () => {
    await expect(loadServerConfig({})).rejects.toThrow(ServerConfigError)
    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: '   ' }),
    ).rejects.toThrow(/LIKEC4_WORKSPACE is not set/)
  })

  it('rejects a missing directory with a clear error', async () => {
    const missing = path.join(tmpdir(), 'likec4-req02-missing')

    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: missing }),
    ).rejects.toThrow(
      `LIKEC4_WORKSPACE "${missing}" does not exist or is not a directory.`,
    )
  })

  it('rejects a file instead of a directory', async () => {
    const workspace = await temporaryDirectory()
    const file = path.join(workspace, 'not-a-directory.txt')
    await writeFile(file, 'text')

    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: file }),
    ).rejects.toThrow(/does not exist or is not a directory/)
  })

  it.skipIf(process.getuid === undefined || process.getuid() === 0)(
    'rejects an unreadable directory',
    async () => {
      const workspace = await temporaryDirectory()
      await chmod(workspace, 0o000)

      await expect(
        loadServerConfig({ LIKEC4_WORKSPACE: workspace }),
      ).rejects.toThrow(/is not readable by this process/)
    },
  )

  it('names only the operator value, not resolved host paths', async () => {
    const relative = './likec4-req02-relative-missing'

    const error = await loadServerConfig({
      LIKEC4_WORKSPACE: relative,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServerConfigError)
    expect((error as Error).message).toContain(relative)
    expect((error as Error).message).not.toContain(path.resolve(relative))
  })

  it('resolves a symlinked workspace without following to its target', async () => {
    const workspace = await temporaryDirectory()
    const secretTarget = path.join(workspace, 'secret-target')
    await mkdir(secretTarget)
    const link = path.join(workspace, 'workspace-link')
    await symlink(secretTarget, link)

    const config = await loadServerConfig({
      LIKEC4_WORKSPACE: link,
      PORT: '8080',
    })

    expect(config.workspaceRoot).toBe(path.resolve(link))
    expect(config.port).toBe(8080)
  })

  it('validates PORT', async () => {
    const workspace = await temporaryDirectory()

    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: workspace, PORT: 'not-a-port' }),
    ).rejects.toThrow(/PORT "not-a-port" is not a valid TCP port/)
    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: workspace, PORT: '70000' }),
    ).rejects.toThrow(ServerConfigError)
    await expect(
      loadServerConfig({ LIKEC4_WORKSPACE: workspace, PORT: '0' }),
    ).rejects.toThrow(ServerConfigError)

    const config = await loadServerConfig({
      LIKEC4_WORKSPACE: workspace,
      PORT: '8080',
    })
    expect(config.port).toBe(8080)
  })
})
