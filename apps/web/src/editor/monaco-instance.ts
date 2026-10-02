/**
 * REQ-06: единственная точка работы с Monaco. Импортируется только отсюда и
 * только через monaco-editor.tsx, чтобы тесты подменяли одну поверхность.
 *
 * Берётся базовый editor.api без языковых contributions: LikeC4 language
 * integration (tokenizer, диагностика) — предмет REQ-09, сейчас достаточно
 * редактируемого buffer и core-сервисов (word-based suggestions, diff).
 */
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

monaco.languages.register({ id: 'likec4' })

// Worker бандлится Vite’ом локально: self-hosted IDE не ходит за кодом наружу.
globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

/** Контрактный язык файла → id языка Monaco. */
export function monacoLanguageId(language: FileContentResponse['language']): string {
  return language === 'likec4' ? 'likec4' : 'plaintext'
}

/** Минимальная поверхность модели, нужная React-компоненту. */
export interface CodeModelHandle {
  getValue(): string
  onDidChangeContent(listener: () => void): () => void
}

/** Модель для редактора: обёртка + сам ITextModel для editor.setModel. */
export interface EditorModelHandle extends CodeModelHandle {
  readonly monacoModel: monaco.editor.ITextModel
}

/** Минимальная поверхность редактора, нужная React-компоненту. */
export interface CodeEditorHandle {
  setModel(model: EditorModelHandle): void
  dispose(): void
}

/** Путь кодируется по сегментам, как в API-клиенте: Uri остаётся стабильным ключом модели. */
function modelUri(relativePath: string): monaco.Uri {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
  return monaco.Uri.from({ scheme: 'likec4', path: `/${encoded}` })
}

function wrapModel(model: monaco.editor.ITextModel): EditorModelHandle {
  return {
    getValue: () => model.getValue(),
    onDidChangeContent: (listener: () => void) => {
      const subscription = model.onDidChangeContent(listener)
      return () => subscription.dispose()
    },
    monacoModel: model,
  }
}

/**
 * Модель на файл переживает переключения: unsaved buffer живёт в модели, а не
 * в React-состоянии, поэтому смена активного файла ничего не теряет.
 * initialValue используется только при первом создании модели.
 */
export function getOrCreateModel(
  relativePath: string,
  language: FileContentResponse['language'],
  initialValue: string,
): EditorModelHandle {
  const uri = modelUri(relativePath)
  const existing = monaco.editor.getModel(uri)
  if (existing !== null) {
    return wrapModel(existing)
  }
  const model = monaco.editor.createModel(initialValue, monacoLanguageId(language), uri)
  // LikeC4-источники в проекте используют 2 пробела; существующий текст не меняется.
  model.updateOptions({ insertSpaces: true, tabSize: 2 })
  return wrapModel(model)
}

export function createCodeEditor(
  container: HTMLElement,
  options: { ariaLabel: string },
): CodeEditorHandle {
  const editor = monaco.editor.create(container, {
    ariaLabel: options.ariaLabel,
    automaticLayout: true,
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    theme: 'vs-dark',
  })
  return {
    setModel: (model) => editor.setModel(model.monacoModel),
    dispose: () => editor.dispose(),
  }
}
