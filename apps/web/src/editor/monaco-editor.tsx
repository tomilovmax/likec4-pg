import { useEffect, useRef, useState } from 'react'

import { MonacoEditorReactComp } from '@typefox/monaco-editor-react'
import type { FileContentResponse } from '@likec4-web-ide/contracts'

import { createLikeC4WrapperConfig } from './likec4-language-config'
import { likeC4LanguageRuntime } from './likec4-language-runtime'

/**
 * REQ-19: editor на официальном Monaco/VS Code runtime (monaco-editor-wrapper
 * + LikeC4 language server в Web Worker). Компонент тонкий: модели, language
 * client и диагностика живут в likec4-language-runtime.
 */
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
  // Смена identity wrapperConfig полностью переинициализирует editor, поэтому
  // конфиг создаётся один раз на монтирование компонента.
  const [wrapperConfig] = useState(() => createLikeC4WrapperConfig())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    let disposed = false
    let subscription: { dispose(): void } | null = null
    void likeC4LanguageRuntime.openModel(path, language, initialValue).then((model) => {
      if (disposed) {
        return
      }
      onChangeRef.current(model.getValue())
      subscription = model.onDidChangeContent(() => onChangeRef.current(model.getValue()))
    })
    return () => {
      disposed = true
      subscription?.dispose()
    }
  }, [initialValue, language, path])

  useEffect(() => {
    likeC4LanguageRuntime.setAriaLabel(ariaLabel)
  }, [ariaLabel])

  return (
    <MonacoEditorReactComp
      className="code-editor-host"
      wrapperConfig={wrapperConfig}
      onLoad={(wrapper) => {
        likeC4LanguageRuntime.attachWrapper(wrapper, wrapperConfig.fsProvider)
      }}
      onError={(error) => {
        likeC4LanguageRuntime.reportError(error)
      }}
    />
  )
}
