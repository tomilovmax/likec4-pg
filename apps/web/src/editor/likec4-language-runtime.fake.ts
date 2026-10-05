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

type Listener = (snapshot: Snapshot) => void

const listeners = new Set<Listener>()
let snapshot: Snapshot = { diagnostics: {}, error: null, status: 'idle' }
let sources: readonly LikeC4Source[] = []

function publish(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export const likeC4LanguageRuntime = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(snapshot)
    return () => listeners.delete(listener)
  },
  async syncSources(nextSources: readonly LikeC4Source[]): Promise<void> {
    sources = nextSources
  },
  async initialize(): Promise<void> {
    publish({ ...snapshot, error: null, status: 'ready' })
  },
  updateSource(path: string, content: string): void {
    sources = sources.map((source) => source.path === path ? { ...source, content } : source)
  },
  async retry(): Promise<void> {
    publish({ ...snapshot, error: null, status: 'ready' })
  },
}

export function publishDiagnostics(diagnostics: DiagnosticsByPath): void {
  publish({ ...snapshot, diagnostics, status: 'ready' })
}

export function readSyncedSources(): readonly LikeC4Source[] {
  return sources
}

export function resetLanguageRuntimeForTest(): void {
  listeners.clear()
  sources = []
  snapshot = { diagnostics: {}, error: null, status: 'idle' }
}

export function markerSeverityLabel(severity: number): string {
  return severity === 8 ? 'Ошибка' : 'Предупреждение'
}
