import path from 'node:path'

import type { ProjectDiagnostic, ProjectResponse } from '@likec4-web-ide/contracts'
import type { LikeC4 } from 'likec4'

type LikeC4Error = ReturnType<LikeC4['getErrors']>[number]

// REQ-14: загрузка полного multi-file LikeC4 проекта официальным API
// likec4@1.59.4 — LikeC4.fromWorkspace() рекурсивно находит и парсит все
// исходники workspace, поэтому parsing context не зависит от того, какой файл
// открыт в editor. Интеграция не зависит от Git.
//
// Пакет импортируется лениво: тяжёлая language-стека не грузится на старте
// сервера — startup с ошибкой конфигурации (REQ-02) остаётся мгновенным,
// первый GET /api/project оплачивает загрузку.
//
// logger:false — logtape остаётся без sinks (ноль вывода, включая абсолютные
// пути); printErrors:false — upstream не печатает ошибки с путями хоста;
// throwIfInvalid:false — повреждённый DSL не reject'ится, ошибки читаем из
// getErrors(). toDSL()/writeDSL() сознательно не вызываются: сериализация
// модели обратно в DSL запрещена границами MVP.
export async function loadWorkspaceProject(
  workspaceRoot: string,
): Promise<ProjectResponse> {
  const { LikeC4 } = await import('likec4')
  const likec4 = await LikeC4.fromWorkspace(workspaceRoot, {
    logger: false,
    printErrors: false,
    throwIfInvalid: false,
  })
  try {
    const errors = likec4.getErrors()
    if (errors.length > 0) {
      return { status: 'invalid', diagnostics: errors.map((e) => toDiagnostic(e, workspaceRoot)) }
    }

    const model = await likec4.computedModel()
    return {
      status: 'ok',
      views: [...model.views()]
        .map((view) => ({ id: view.id as string, title: view.title }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      elements: [...model.elements()]
        .map((element) => ({
          id: element.id as string,
          kind: element.kind as string,
          title: element.title,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }
  } finally {
    await likec4.dispose()
  }
}

// Диагностика отдаётся клиенту без абсолютных путей хоста: sourceFsPath
// становится workspace-относительным path (вне корня — поле опускается),
// а вхождения корня в message заменяются на относительную форму.
function toDiagnostic(error: LikeC4Error, workspaceRoot: string): ProjectDiagnostic {
  const relative = relativeToWorkspace(error.sourceFsPath, workspaceRoot)
  const message = error.message.split(workspaceRoot).join('.')
  return {
    message,
    ...(relative === undefined ? {} : { path: relative }),
    range: error.range,
  }
}

function relativeToWorkspace(fsPath: string, workspaceRoot: string): string | undefined {
  if (!fsPath) {
    return undefined
  }
  const relative = path.relative(workspaceRoot, fsPath)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  return relative
}
