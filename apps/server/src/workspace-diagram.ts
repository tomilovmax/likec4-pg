import type { DiagramModelData, DiagramResponse } from '@likec4-web-ide/contracts'

import { toDiagnostic } from './workspace-diagnostics.js'

// REQ-15: layouted-модель для интерактивного preview. Официальный renderer
// likec4/react (субпаф likec4@1.59.4) на клиенте получает ровно то, что вернул
// layoutedModel(): $data — чистый JSON, передаётся по HTTP без трансформации.
//
// Порядок проверок повторяет REQ-14: getErrors() читается ДО layout — при
// повреждённом DSL layoutedModel() всё равно вернул бы половинную модель с
// implicit view, и preview выдал бы устаревшую диаграмму за актуальную.
export async function loadWorkspaceDiagram(workspaceRoot: string): Promise<DiagramResponse> {
  const { LikeC4 } = await import('likec4')
  const likec4 = await LikeC4.fromWorkspace(workspaceRoot, {
    logger: false,
    printErrors: false,
    throwIfInvalid: false,
  })
  try {
    const errors = likec4.getErrors()
    if (errors.length > 0) {
      return {
        status: 'invalid',
        diagnostics: errors.map((error) => toDiagnostic(error, workspaceRoot)),
      }
    }

    const model = await likec4.layoutedModel()
    const views = [...model.views()]
      .map((view) => ({ id: view.id as string, title: view.title }))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (views.length === 0) {
      return { status: 'empty', reason: 'NO_VIEWS' }
    }
    return {
      status: 'ready',
      // $data — чистый JSON с теми же ключами; каст нужен только потому, что
      // looseObject-вывод контракта несёт индексную сигнатуру, которой нет у
      // типа upstream.
      model: model.$data as DiagramModelData,
      views,
      defaultViewId: pickDefaultViewId(views),
    }
  } finally {
    await likec4.dispose()
  }
}

// Детерминированное правило REQ-15 (выбор view — REQ-16): implicit 'index' —
// официальная landing view upstream, иначе лексикографически первая view.
function pickDefaultViewId(views: ReadonlyArray<{ id: string }>): string {
  return views.find((view) => view.id === 'index')?.id ?? views[0]!.id
}
