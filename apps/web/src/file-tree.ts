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
