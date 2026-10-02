/**
 * Единственные правила фильтрации файлов workspace (REQ-04). Используются
 * обходом дерева в `listFiles` и будут переиспользованы endpoint’ом чтения
 * (REQ-05), поэтому список и чтение не могут разойтись: файл либо разрешён
 * обоим, либо обоим запрещён.
 *
 * Разрешены LikeC4-исходники (расширения `.c4` и `.likec4`, без учёта регистра)
 * и конфигурационные файлы LikeC4. Состав config-имён зафиксирован документацией
 * upstream v1.59.4 (apps/docs/src/content/docs/dsl/Config/index.mdx):
 * `.likec4rc`, `.likec4.config.json`, `likec4.config.json`, `likec4.config.js`,
 * `likec4.config.mjs`, `likec4.config.ts`, `likec4.config.mts`.
 *
 * Всё остальное (бинарные файлы, README, изображения, произвольный JSON) не
 * предлагается как редактируемый DSL: классификация идёт по имени записи,
 * содержимое не анализируется.
 */

const likec4SourceExtensions = new Set(['.c4', '.likec4'])

const likec4ConfigNames = new Set([
  '.likec4rc',
  '.likec4.config.json',
  'likec4.config.json',
  'likec4.config.js',
  'likec4.config.mjs',
  'likec4.config.ts',
  'likec4.config.mts',
])

export type WorkspaceFileLanguage = 'likec4' | 'config'

/** Возвращает language разрешённого файла либо undefined для нерелевантного. */
export function classifyWorkspaceFile(name: string): WorkspaceFileLanguage | undefined {
  if (likec4ConfigNames.has(name)) {
    return 'config'
  }
  const dot = name.lastIndexOf('.')
  if (dot >= 0 && likec4SourceExtensions.has(name.slice(dot).toLowerCase())) {
    return 'likec4'
  }
  return undefined
}

/**
 * Скрытые записи (`.git`, `.DS_Store`, `.idea`) не участвуют в дереве.
 * Исключение — config-файлы LikeC4: они сами начинаются с точки, но являются
 * частью проекта.
 */
export function isHiddenEntry(name: string): boolean {
  return name.startsWith('.') && classifyWorkspaceFile(name) === undefined
}
