/**
 * jsdom-реализация поверхности monaco-instance для тестов: Monaco не работает
 * в jsdom, поэтому модель — запись в Map (переживает переключение файлов, как
 * настоящая), а редактор — <textarea>, чей input синхронизируется с моделью.
 */
import type { CodeEditorHandle, CodeModelHandle } from './monaco-instance'

interface FakeModel {
  value: string
  listeners: Set<() => void>
}

type FakeModelHandle = CodeModelHandle & { fake: FakeModel }

const models = new Map<string, FakeModel>()

/** Сбрасывает буферы между тестами (эквивалент перезагрузки страницы). */
export function resetForTest(): void {
  models.clear()
}

/**
 * Буквальное содержимое buffer’а. textarea.value по спецификации HTML
 * нормализует CRLF в LF, а модель (как настоящая Monaco) хранит текст как есть.
 */
export function readFakeModel(relativePath: string): string | undefined {
  return models.get(relativePath)?.value
}

export function getOrCreateModel(
  relativePath: string,
  _language: string,
  initialValue: string,
): FakeModelHandle {
  let model = models.get(relativePath)
  if (model === undefined) {
    model = { value: initialValue, listeners: new Set() }
    models.set(relativePath, model)
  }
  const stored = model
  return {
    getValue: () => stored.value,
    onDidChangeContent: (listener: () => void) => {
      stored.listeners.add(listener)
      return () => {
        stored.listeners.delete(listener)
      }
    },
    fake: stored,
  }
}

export function createCodeEditor(
  container: HTMLElement,
  options: { ariaLabel: string },
): CodeEditorHandle {
  const textarea = document.createElement('textarea')
  textarea.setAttribute('aria-label', options.ariaLabel)
  container.appendChild(textarea)

  let model: FakeModel | null = null
  const syncFromTextarea = () => {
    if (model === null) {
      return
    }
    model.value = textarea.value
    for (const listener of model.listeners) {
      listener()
    }
  }
  textarea.addEventListener('input', syncFromTextarea)
  textarea.addEventListener('change', syncFromTextarea)

  return {
    setModel: (handle) => {
      // В рантайме handle всегда создан getOrCreateModel этого модуля.
      model = (handle as unknown as FakeModelHandle).fake
      textarea.value = model.value
    },
    dispose: () => {
      textarea.remove()
    },
  }
}
