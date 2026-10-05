import type { FileEntry } from '@likec4-web-ide/contracts'

export interface FileTreeNode {
  entry: FileEntry
  children: FileTreeNode[]
}

/**
 * Собирает вложенное дерево из плоского ответа `GET /api/files`.
 * Порядок сервера сохраняется: внутри каталога сначала подкаталоги, затем
 * файлы, каждый список — по имени.
 */
export function buildFileTree(items: FileEntry[]): FileTreeNode[] {
  const nodes = new Map<string, FileTreeNode>()
  for (const item of items) {
    nodes.set(item.path, { entry: item, children: [] })
  }

  const roots: FileTreeNode[] = []
  for (const item of items) {
    const separator = item.path.lastIndexOf('/')
    const parent = separator === -1 ? undefined : nodes.get(item.path.slice(0, separator))
    if (parent) {
      parent.children.push(nodes.get(item.path)!)
    } else {
      roots.push(nodes.get(item.path)!)
    }
  }
  return roots
}

/**
 * REQ-10: новый workspace-относительный путь после переименования записи
 * `from` → `toPath` (переименование каталога перепривязывает и всё его
 * содержимое). `null` — путь не затронут.
 */
export function remapRelativePath(
  path: string,
  from: string,
  toPath: string,
): string | null {
  if (path === from) {
    return toPath
  }
  if (path.startsWith(`${from}/`)) {
    return `${toPath}/${path.slice(from.length + 1)}`
  }
  return null
}
