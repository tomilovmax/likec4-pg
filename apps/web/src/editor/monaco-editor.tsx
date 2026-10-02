import { useEffect, useRef } from 'react'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

import {
  createCodeEditor,
  getOrCreateModel,
  type CodeEditorHandle,
} from './monaco-instance'

interface MonacoEditorProps {
  ariaLabel: string
  /** Сохранённый текст файла: база buffer’а и значение только что созданной модели. */
  initialValue: string
  language: FileContentResponse['language']
  /** Вызывается и при переключении модели, чтобы восстановить dirty state её buffer’а. */
  onChange: (value: string) => void
  path: string
}

/**
 * REQ-06: один экземпляр редактора на панель, файлы переключаются сменой
 * модели. Содержимое задаётся буквально, без format-on-load; изменения текста
 * уходят наверх через onChange.
 */
export function MonacoEditor({ ariaLabel, initialValue, language, onChange, path }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CodeEditorHandle | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const container = containerRef.current
    if (container === null) {
      return
    }
    const editor = createCodeEditor(container, { ariaLabel })
    editorRef.current = editor
    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [ariaLabel])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) {
      return
    }
    const model = getOrCreateModel(path, language, initialValue)
    editor.setModel(model)
    // Возврат к ранее изменённому buffer обязан вернуть и dirty state.
    onChangeRef.current(model.getValue())
    return model.onDidChangeContent(() => onChangeRef.current(model.getValue()))
  }, [initialValue, language, path])

  return <div className="code-editor-host" ref={containerRef} />
}
