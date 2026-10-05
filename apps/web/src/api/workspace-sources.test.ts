import { describe, expect, it, vi } from 'vitest'

import { loadWorkspaceSources } from './workspace-sources'

const { listFiles, readFile } = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('./client', () => ({
  api: { listFiles, readFile },
}))

describe('loadWorkspaceSources', () => {
  it('loads all LikeC4 documents, excludes config and reuses the active source', async () => {
    listFiles.mockResolvedValue({
      items: [
        { path: 'model', name: 'model', kind: 'directory' },
        { path: 'model/system.c4', name: 'system.c4', kind: 'file', language: 'likec4' },
        { path: 'views/index.likec4', name: 'index.likec4', kind: 'file', language: 'likec4' },
        { path: 'likec4.config.ts', name: 'likec4.config.ts', kind: 'file', language: 'config' },
      ],
    })
    readFile.mockResolvedValue({
      path: 'views/index.likec4',
      name: 'index.likec4',
      language: 'likec4',
      content: 'views {}',
      version: 'a'.repeat(64),
    })

    const result = await loadWorkspaceSources({ path: 'model/system.c4', content: 'model {}' })

    expect(readFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledWith('views/index.likec4')
    expect(result.failures).toEqual([])
    expect(result.sources).toEqual([
      { path: 'model/system.c4', content: 'model {}' },
      { path: 'views/index.likec4', content: 'views {}' },
    ])
  })

  it('returns a per-file failure without dropping the remaining documents', async () => {
    listFiles.mockResolvedValue({
      items: [
        { path: 'a.c4', name: 'a.c4', kind: 'file', language: 'likec4' },
        { path: 'b.likec4', name: 'b.likec4', kind: 'file', language: 'likec4' },
      ],
    })
    readFile.mockImplementation((path: string) => {
      if (path === 'a.c4') {
        return Promise.reject(new Error('Unreadable source'))
      }
      return Promise.resolve({
        path,
        name: 'b.likec4',
        language: 'likec4',
        content: 'views {}',
        version: 'b'.repeat(64),
      })
    })

    const result = await loadWorkspaceSources()

    expect(result.sources).toEqual([{ path: 'b.likec4', content: 'views {}' }])
    expect(result.failures).toEqual([{ path: 'a.c4', message: 'Unreadable source' }])
  })
})
