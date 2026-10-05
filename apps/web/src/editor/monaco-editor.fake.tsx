/**
 * jsdom-реализация границы editor-компонента для тестов: Monaco, VS Code
 * services и browser LSP не работают в jsdom, поэтому модель — запись в Map
 * (переживает переключение файлов, как настоящая), а editor — <textarea>,
 * чей input синхронизируется с моделью.
 */
import { useEffect, useRef } from 'react'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

interface FakeModel {
  value: string
  listeners: Set<() => void>
}

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

function getOrCreateModel(relativePath: string, initialValue: string): FakeModel {
  let model = models.get(relativePath)
  if (model === undefined) {
    model = { value: initialValue, listeners: new Set() }
    models.set(relativePath, model)
  }
  return model
}

export function MonacoEditor({
  ariaLabel,
  initialValue,
  language,
  onChange,
  path,
}: {
  ariaLabel: string
  initialValue: string
  language: FileContentResponse['language']
  onChange: (value: string) => void
  path: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const container = host.current
    if (container === null) {
      return
    }
    // REQ-10: как настоящий runtime — seed новой модели актуальным buffer;
    // эффект перезапускается только сменой файла/языка, не правками текста.
    const model = getOrCreateModel(path, initialValue)

    const textarea = document.createElement('textarea')
    textarea.setAttribute('aria-label', ariaLabel)
    textarea.value = model.value
    container.appendChild(textarea)

    const syncFromTextarea = () => {
      model.value = textarea.value
      for (const listener of model.listeners) {
        listener()
      }
    }
    textarea.addEventListener('input', syncFromTextarea)
    textarea.addEventListener('change', syncFromTextarea)

    const notify = () => onChangeRef.current(model.value)
    model.listeners.add(notify)
    onChangeRef.current(model.value)

    return () => {
      model.listeners.delete(notify)
      textarea.removeEventListener('input', syncFromTextarea)
      textarea.removeEventListener('change', syncFromTextarea)
      textarea.remove()
    }
  }, [ariaLabel, language, path])

  return <div className="code-editor-host" ref={host} />
}
