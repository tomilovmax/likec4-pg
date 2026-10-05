import type { ProjectResponse } from '@likec4-web-ide/contracts'

import { toDiagnostic } from './workspace-diagnostics.js'

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
