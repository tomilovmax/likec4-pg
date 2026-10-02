import { describe, expect, it } from 'vitest'

import { classifyWorkspaceFile, isHiddenEntry } from './allowed-files.js'

describe('REQ-04 workspace file classification', () => {
  it('allows LikeC4 sources by extension regardless of case', () => {
    expect(classifyWorkspaceFile('model.c4')).toBe('likec4')
    expect(classifyWorkspaceFile('overview.likec4')).toBe('likec4')
    expect(classifyWorkspaceFile('Nested.Model.C4')).toBe('likec4')
  })

  it('allows every LikeC4 config file name documented upstream', () => {
    for (const name of [
      '.likec4rc',
      '.likec4.config.json',
      'likec4.config.json',
      'likec4.config.js',
      'likec4.config.mjs',
      'likec4.config.ts',
      'likec4.config.mts',
    ]) {
      expect(classifyWorkspaceFile(name)).toBe('config')
    }
  })

  it('rejects binary and irrelevant files', () => {
    expect(classifyWorkspaceFile('README.md')).toBeUndefined()
    expect(classifyWorkspaceFile('logo.png')).toBeUndefined()
    expect(classifyWorkspaceFile('package.json')).toBeUndefined()
    expect(classifyWorkspaceFile('backup.c4.bak')).toBeUndefined()
    expect(classifyWorkspaceFile('likec4-config.json')).toBeUndefined()
  })

  it('treats dot entries as hidden except LikeC4 config files', () => {
    expect(isHiddenEntry('.git')).toBe(true)
    expect(isHiddenEntry('.DS_Store')).toBe(true)
    expect(isHiddenEntry('.idea')).toBe(true)
    expect(isHiddenEntry('.likec4rc')).toBe(false)
    expect(isHiddenEntry('.likec4.config.json')).toBe(false)
  })
})
