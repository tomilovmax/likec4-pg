import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { FileEntry } from '@likec4-web-ide/contracts'

import { classifyWorkspaceFile, isHiddenEntry } from './domain/allowed-files.js'
import { isWithin, type WorkspacePathResolver } from './workspace-paths.js'

/**
 * Обход workspace для `GET /api/files` (REQ-04). Стартует от доверенного
 * realpath-корня resolver’а (REQ-03) и физически не выходит за него:
 * каждая запись проверяется по realpath, поэтому symlink наружу не попадает
 * в дерево. Внутренние symlink разрешены; realpath посещённых каталогов
 * запоминается, поэтому циклы symlink не зацикливают обход, а каталог
 * показывается один раз.
 *
 * Дерево содержит только разрешённые файлы (`allowed-files.ts`) и каталоги,
 * ведущие к ним; скрытые записи и ветки без LikeC4-файлов вырезаются.
 * Недоступный для чтения подкаталог пропускается — он не ломает всё дерево.
 * Порядок детерминирован: внутри каталога сначала подкаталоги, затем файлы,
 * каждый список — по имени; за каталогом сразу идёт его содержимое.
 */
export async function listWorkspaceFiles(
  resolver: WorkspacePathResolver,
): Promise<FileEntry[]> {
  const root = await resolver.trustedRoot()
  return walkDirectory(root, '', root, new Set([root]))
}

async function walkDirectory(
  directoryPath: string,
  relativeDirectory: string,
  root: string,
  visitedDirectories: Set<string>,
): Promise<FileEntry[]> {
  const dirents = await readdir(directoryPath, { withFileTypes: true })

  const directoryEntries: { entry: FileEntry; children: FileEntry[] }[] = []
  const fileEntries: FileEntry[] = []

  for (const dirent of dirents) {
    if (isHiddenEntry(dirent.name)) {
      continue
    }

    const entryPath = path.join(directoryPath, dirent.name)
    const relativePath =
      relativeDirectory === '' ? dirent.name : `${relativeDirectory}/${dirent.name}`

    // realpath проверяет фактическую цель записи: symlink наружу workspace
    // отбрасывается до любой классификации (критерий «дерево не содержит
    // entry за границами workspace»).
    let realPath: string
    try {
      realPath = await realpath(entryPath)
    } catch {
      // Запись исчезла между readdir и realpath либо битый symlink.
      continue
    }
    if (!isWithin(root, realPath)) {
      continue
    }

    const stats = await stat(realPath).catch(() => null)
    if (stats?.isDirectory()) {
      if (visitedDirectories.has(realPath)) {
        continue
      }
      visitedDirectories.add(realPath)

      // Недоступный подкаталог пропускаем — он не ломает всё дерево.
      const children = await walkDirectory(
        realPath,
        relativePath,
        root,
        visitedDirectories,
      ).catch(() => [])
      if (children.length > 0) {
        directoryEntries.push({
          entry: { path: relativePath, name: dirent.name, kind: 'directory' },
          children,
        })
      }
    } else if (stats?.isFile()) {
      const language = classifyWorkspaceFile(dirent.name)
      if (language !== undefined) {
        fileEntries.push({
          path: relativePath,
          name: dirent.name,
          kind: 'file',
          language,
        })
      }
    }
  }

  const byName = (a: FileEntry, b: FileEntry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const sortedDirectories = [...directoryEntries].sort((a, b) => byName(a.entry, b.entry))
  return [
    ...sortedDirectories.flatMap(({ entry, children }) => [entry, ...children]),
    ...[...fileEntries].sort(byName),
  ]
}
