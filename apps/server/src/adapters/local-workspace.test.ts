import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LocalWorkspaceProvider } from './local-workspace.js'

const createdDirectories: string[] = []

async function temporaryWorkspace(name = 'architecture'): Promise<string> {
  const parent = await mkdtemp(path.join(tmpdir(), 'likec4-req02-'))
  createdDirectories.push(parent)
  return path.join(parent, name)
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

  it('keeps file and diagram resources on their placeholder shape', async () => {
    const provider = new LocalWorkspaceProvider(await temporaryWorkspace())

    expect(await provider.listFiles()).toEqual({ items: [] })
    expect(await provider.getDiagram()).toEqual({
      status: 'empty',
      reason: 'NO_WORKSPACE_VIEW',
    })
  })
})
