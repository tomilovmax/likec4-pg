import * as monaco from '@codingame/monaco-vscode-editor-api'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

/**
 * Единственный источник Monaco-инстанции приложения. Импортировать
 * `monaco-editor` напрямую нельзя: рядом с `@codingame/monaco-vscode-editor-api`
 * это второй, независимый экземпляр Monaco со своим реестром моделей.
 */

export function monacoLanguageId(language: FileContentResponse['language']): string {
  return language === 'likec4' ? 'likec4' : 'plaintext'
}

/**
 * Внутренний URI модели. `file:///relative/path` существует только в памяти
 * браузера (overlay filesystem + Monaco models) и не раскрывает путь хоста.
 */
export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.file(`/${path}`)
}

export function pathFromUri(uri: monaco.Uri): string {
  return decodeURIComponent(uri.path.slice(1))
}

/**
 * REQ-06: существующая модель не перечитывается — изолированный buffer
 * переживает переключение файлов и повторную фоновую синхронизацию.
 */
export function getOrCreateModel(
  path: string,
  language: FileContentResponse['language'],
  initialValue: string,
): monaco.editor.ITextModel {
  const uri = modelUri(path)
  const existing = monaco.editor.getModel(uri)
  if (existing !== null) {
    return existing
  }
  const model = monaco.editor.createModel(initialValue, monacoLanguageId(language), uri)
  model.updateOptions({ insertSpaces: true, tabSize: 2 })
  return model
}

export function onMarkersChange(listener: (uris: readonly monaco.Uri[]) => void): monaco.IDisposable {
  return monaco.editor.onDidChangeMarkers(listener)
}

/** Маркеры модели по workspace-относительному пути (все owners). */
export function getModelMarkers(path: string): readonly monaco.editor.IMarker[] {
  return monaco.editor.getModelMarkers({ resource: modelUri(path) })
}
