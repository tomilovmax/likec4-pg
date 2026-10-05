import path from 'node:path'

import type { ProjectDiagnostic } from '@likec4-web-ide/contracts'
import type { LikeC4 } from 'likec4'

export type LikeC4Error = ReturnType<LikeC4['getErrors']>[number]

// Диагностика отдаётся клиенту без абсолютных путей хоста: sourceFsPath
// становится workspace-относительным path (вне корня — поле опускается),
// а вхождения корня в message заменяются на относительную форму.
export function toDiagnostic(error: LikeC4Error, workspaceRoot: string): ProjectDiagnostic {
  const relative = relativeToWorkspace(error.sourceFsPath, workspaceRoot)
  const message = error.message.split(workspaceRoot).join('.')
  return {
    message,
    ...(relative === undefined ? {} : { path: relative }),
    range: error.range,
  }
}

export function relativeToWorkspace(fsPath: string, workspaceRoot: string): string | undefined {
  if (!fsPath) {
    return undefined
  }
  const relative = path.relative(workspaceRoot, fsPath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  return relative
}
