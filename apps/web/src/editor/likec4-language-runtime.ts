import { RegisteredMemoryFile } from '@codingame/monaco-vscode-files-service-override'
import type { RegisteredFileSystemProvider } from '@codingame/monaco-vscode-files-service-override'
import { BuildDocuments } from '@likec4/language-server/protocol'
import LikeC4LspWorker from '@likec4/language-server/browser-worker?worker'
import type { MonacoEditorLanguageClientWrapper } from 'monaco-editor-wrapper'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

import { getModelMarkers, getOrCreateModel, modelUri, onMarkersChange } from './likec4-monaco'

export interface LikeC4Source {
  path: string
  content: string
}

export interface LikeC4Diagnostic {
  message: string
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  severity: number
}

export type DiagnosticsByPath = Readonly<Record<string, readonly LikeC4Diagnostic[]>>
export type LanguageRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error'

interface Snapshot {
  diagnostics: DiagnosticsByPath
  error: string | null
  status: LanguageRuntimeStatus
}

interface DesiredActiveModel {
  path: string
  language: FileContentResponse['language']
  initialValue: string
  resolve: (model: ReturnType<typeof getOrCreateModel>) => void
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== '') {
    return error.message
  }
  return fallback
}

/**
 * REQ-19: browser runtime официального LikeC4 language server
 * (`@likec4/language-server` 1.59.4 в Web Worker через monaco-editor-wrapper).
 *
 * Модели Monaco — единственный источник текста: правки уходят language server
 * стандартным textDocument/didChange, диагностика возвращается
 * publishDiagnostics и наблюдается как Monaco markers.
 */
class LikeC4LanguageRuntime {
  private listeners = new Set<(snapshot: Snapshot) => void>()
  private snapshot: Snapshot = { diagnostics: {}, error: null, status: 'idle' }
  private wrapper: MonacoEditorLanguageClientWrapper | null = null
  private fsProvider: RegisteredFileSystemProvider | null = null
  private pendingSources: readonly LikeC4Source[] | null = null
  private desiredActive: DesiredActiveModel | null = null
  private knownPaths = new Set<string>()
  private markersSubscription: ReturnType<typeof onMarkersChange> | null = null
  private ariaLabel: string | null = null

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }

  /** Вызывается компонентом editor’а, когда wrapper инициализирован. */
  attachWrapper(
    wrapper: MonacoEditorLanguageClientWrapper,
    fsProvider: RegisteredFileSystemProvider,
  ): void {
    this.wrapper = wrapper
    this.fsProvider = fsProvider
    this.markersSubscription?.dispose()
    this.markersSubscription = onMarkersChange(() => this.publishDiagnostics())
    this.applyAriaLabel()
    if (this.desiredActive !== null) {
      const desired = this.desiredActive
      this.desiredActive = null
      const model = this.openModelNow(desired.path, desired.language, desired.initialValue)
      desired.resolve(model)
    }
    if (this.pendingSources !== null) {
      const sources = this.pendingSources
      this.pendingSources = null
      void this.applySources(sources)
    }
  }

  /**
   * Гарантирует модель файла и показывает её в editor’е. До готовности wrapper
   * запрос только запоминается: трогать Monaco API до инициализации VS Code
   * services нельзя — standalone-вызов сам запускает initialize() и ломает
   * последующую инициализацию wrapper’а («Services are already initialized»).
   */
  openModel(
    path: string,
    language: FileContentResponse['language'],
    initialValue: string,
  ): Promise<ReturnType<typeof getOrCreateModel>> {
    if (this.wrapper === null) {
      return new Promise((resolve) => {
        // Более ранняя ожидающая модель уже неактивна: её caller (React-эффект)
        // к этому моменту разобран, поэтому resolver просто замещается.
        this.desiredActive = { path, language, initialValue, resolve }
      })
    }
    return Promise.resolve(this.openModelNow(path, language, initialValue))
  }

  private openModelNow(
    path: string,
    language: FileContentResponse['language'],
    initialValue: string,
  ): ReturnType<typeof getOrCreateModel> {
    const model = getOrCreateModel(path, language, initialValue)
    if (language === 'likec4') {
      this.knownPaths.add(path)
      this.registerInMemoryFs(path, model.getValue())
    }
    this.showModel(path, language, initialValue)
    return model
  }

  private showModel(
    path: string,
    language: FileContentResponse['language'],
    initialValue: string,
  ): ReturnType<typeof getOrCreateModel> | null {
    const editor = this.wrapper?.getEditor()
    if (editor === undefined) {
      return null
    }
    const model = getOrCreateModel(path, language, initialValue)
    if (editor.getModel()?.uri.toString() !== model.uri.toString()) {
      editor.setModel(model)
    }
    return model
  }

  /**
   * Полный набор LikeC4-источников workspace. Существующие модели не
   * перезаписываются: unsaved buffer приоритетнее первоначального текста API.
   */
  async syncSources(sources: readonly LikeC4Source[]): Promise<void> {
    if (this.wrapper === null) {
      this.pendingSources = sources
      this.publish({ error: null, status: 'starting' })
      return
    }
    await this.applySources(sources)
  }

  /** Write-through unsaved buffer в memory filesystem (фоновой набор). */
  updateSource(path: string, content: string): void {
    if (!this.knownPaths.has(path)) {
      return
    }
    this.fsProvider?.writeFile(
      modelUri(path),
      new TextEncoder().encode(content),
      { atomic: false, create: true, overwrite: true, unlock: false },
    ).catch(() => {
      // Неблокирующая best-effort синхронизация: live-диагностика идёт
      // через textDocument/didChange самой модели.
    })
  }

  async retry(): Promise<void> {
    const wrapper = this.wrapper
    if (wrapper === null) {
      if (this.pendingSources !== null) {
        const sources = this.pendingSources
        this.pendingSources = null
        await this.applySources(sources)
      }
      return
    }
    this.publish({ error: null, status: 'starting' })
    try {
      const clientWrapper = wrapper.getLanguageClientWrapper('likec4')
      if (clientWrapper === undefined) {
        throw new Error('LikeC4 language client wrapper недоступен')
      }
      await clientWrapper.restartLanguageClient(new LikeC4LspWorker())
      await this.buildDocuments([...this.knownPaths].map((path) => modelUri(path).toString()))
      this.publish({ error: null, status: 'ready' })
    } catch (error: unknown) {
      this.publish({
        error: errorMessage(error, 'Не удалось перезапустить LikeC4 language service'),
        status: 'error',
      })
    }
  }

  reportError(error: unknown): void {
    this.publish({
      error: errorMessage(error, 'Ошибка LikeC4 language service'),
      status: 'error',
    })
  }

  setAriaLabel(ariaLabel: string): void {
    this.ariaLabel = ariaLabel
    this.applyAriaLabel()
  }

  private applyAriaLabel(): void {
    if (this.ariaLabel !== null) {
      this.wrapper?.getEditor()?.updateOptions({ ariaLabel: this.ariaLabel })
    }
  }

  private async applySources(sources: readonly LikeC4Source[]): Promise<void> {
    this.publish({ error: null, status: 'starting' })
    const docs: string[] = []
    for (const source of sources) {
      const model = getOrCreateModel(source.path, 'likec4', source.content)
      this.knownPaths.add(source.path)
      this.registerInMemoryFs(source.path, model.getValue())
      docs.push(modelUri(source.path).toString())
    }
    if (docs.length === 0) {
      this.publish({ error: null, status: 'ready' })
      return
    }
    try {
      await this.buildDocuments(docs)
      this.publish({ error: null, status: 'ready' })
    } catch (error: unknown) {
      this.publish({
        error: errorMessage(error, 'LikeC4 language service недоступен'),
        status: 'error',
      })
    }
  }

  private async buildDocuments(docs: readonly string[]): Promise<void> {
    const client = this.wrapper?.getLanguageClient('likec4')
    if (client === undefined) {
      throw new Error('LikeC4 language client не запущен')
    }
    await client.sendRequest(BuildDocuments.req, { docs: [...docs] })
  }

  private registerInMemoryFs(path: string, content: string): void {
    if (this.fsProvider === null) {
      return
    }
    try {
      this.fsProvider.registerFile(new RegisteredMemoryFile(modelUri(path), content))
    } catch {
      // Файл уже зарегистрирован повторной синхронизацией.
    }
  }

  private publishDiagnostics(): void {
    const diagnostics: Record<string, LikeC4Diagnostic[]> = {}
    for (const path of this.knownPaths) {
      const markers = getModelMarkers(path)
      if (markers.length === 0) {
        continue
      }
      diagnostics[path] = markers.map((marker) => ({
        message: marker.message,
        range: {
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn,
        },
        severity: marker.severity,
      }))
    }
    this.publish({ diagnostics })
  }
}

export const likeC4LanguageRuntime = new LikeC4LanguageRuntime()

export function markerSeverityLabel(severity: number): string {
  return severity === 8 ? 'Ошибка' : 'Предупреждение'
}
