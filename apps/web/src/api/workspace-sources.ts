import { api } from './client'

import type { LikeC4Source } from '../editor/likec4-language-runtime'

export interface SourceLoadFailure {
  path: string
  message: string
}

export interface WorkspaceSources {
  failures: readonly SourceLoadFailure[]
  sources: readonly LikeC4Source[]
}

const readConcurrency = 4

/**
 * Загружает полный разрешённый DSL-набор через уже существующий file API.
 * Конфигурационный JavaScript/TypeScript намеренно не попадает в browser runtime
 * и никогда не исполняется клиентом.
 */
export async function loadWorkspaceSources(activeSource?: LikeC4Source): Promise<WorkspaceSources> {
  const files = await api.listFiles()
  const paths = files.items
    .filter((entry) => entry.kind === 'file' && entry.language === 'likec4')
    .map((entry) => entry.path)
  const results: Array<LikeC4Source | SourceLoadFailure> = activeSource === undefined ? [] : [activeSource]
  let nextPath = 0

  async function worker(): Promise<void> {
    while (nextPath < paths.length) {
      const path = paths[nextPath]
      nextPath += 1
      if (path === undefined) {
        return
      }
      if (path === activeSource?.path) {
        continue
      }
      try {
        const content = await api.readFile(path)
        if (content.path !== path || content.language !== 'likec4') {
          results.push({ path, message: 'API вернул некорректный LikeC4 документ' })
        } else {
          results.push({ path, content: content.content })
        }
      } catch (error: unknown) {
        results.push({
          path,
          message: error instanceof Error ? error.message : 'Не удалось прочитать LikeC4 документ',
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(readConcurrency, paths.length) }, () => worker()))
  return {
    sources: results.filter((result): result is LikeC4Source => 'content' in result),
    failures: results.filter((result): result is SourceLoadFailure => 'message' in result),
  }
}
