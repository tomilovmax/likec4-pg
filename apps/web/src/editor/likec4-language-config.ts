import * as monaco from '@codingame/monaco-vscode-editor-api'
import {
  RegisteredFileSystemProvider,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override'
import LikeC4LspWorker from '@likec4/language-server/browser-worker?worker'
import type { WrapperConfig } from 'monaco-editor-wrapper'
import { configureDefaultWorkerFactory } from 'monaco-editor-wrapper/workers/workerLoaders'

import languageConfiguration from './upstream/language-configuration.json?raw'
import textMateGrammar from './upstream/likec4.tmLanguage.json?raw'

/**
 * Адаптация `apps/playground/src/monaco/config.ts` LikeC4 v1.59.4
 * (33dbc2d34c399a99daf96e92fc28fe5d280a7fd5, MIT).
 *
 * В отличие от Playground здесь остаётся только редакторский runtime: без
 * Cloudflare, preview и записи исходников на сервер.
 */
export interface LikeC4WrapperConfig extends WrapperConfig {
  fsProvider: RegisteredFileSystemProvider
}

let overlayRegistration: monaco.IDisposable | null = null

export function createLikeC4WrapperConfig(): LikeC4WrapperConfig {
  const extensionFilesOrContents = new Map<string, string | URL>([
    ['/likec4-language-configuration.json', languageConfiguration],
    ['/likec4-language-grammar.json', textMateGrammar],
  ])
  const fsProvider = new RegisteredFileSystemProvider(false)
  overlayRegistration?.dispose()
  overlayRegistration = registerFileSystemOverlay(1, fsProvider)

  return {
    $type: 'extended',
    fsProvider,
    logLevel: 2,
    vscodeApiConfig: {
      loadThemes: true,
      viewsConfig: {
        viewServiceType: 'EditorService',
        // Открытие «файла» через VS Code services (например, LSP-переход)
        // переиспользует единственный editor и переключает его модель.
        openEditorFunc: async (modelRef) => {
          const editor = monaco.editor.getEditors()[0]
          if (editor === undefined) {
            return undefined
          }
          editor.setModel(modelRef.object.textEditorModel)
          return editor
        },
      },
      enableExtHostWorker: false,
      userConfiguration: {
        json: JSON.stringify({
          'workbench.colorTheme': 'Default Dark+',
          'editor.wordBasedSuggestions': 'off',
          'editor.experimental.asyncTokenization': true,
        }),
      },
    },
    editorAppConfig: {
      useDiffEditor: false,
      monacoWorkerFactory: configureDefaultWorkerFactory,
      editorOptions: {
        ariaLabel: 'Исходный текст LikeC4',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        theme: 'Default Dark+',
        'semanticHighlighting.enabled': true,
        wordBasedSuggestions: 'off',
      },
    },
    extensions: [
      {
        config: {
          name: 'likec4',
          publisher: 'likec4',
          version: '1.59.4',
          engines: { vscode: '*' },
          contributes: {
            languages: [
              {
                id: 'likec4',
                extensions: ['.c4', '.likec4'],
                aliases: ['likec4', 'LikeC4'],
                configuration: '/likec4-language-configuration.json',
              },
            ],
            grammars: [
              {
                language: 'likec4',
                scopeName: 'source.likec4',
                path: '/likec4-language-grammar.json',
                embeddedLanguages: { 'meta.embedded.block.markdown': 'markdown' },
              },
            ],
          },
        },
        filesOrContents: extensionFilesOrContents,
      },
    ],
    languageClientConfigs: {
      automaticallyInit: true,
      automaticallyStart: true,
      configs: {
        likec4: {
          name: 'likec4',
          clientOptions: {
            workspaceFolder: {
              index: 0,
              name: 'likec4-web-ide',
              uri: monaco.Uri.parse('file:///'),
            },
            documentSelector: [{ language: 'likec4' }],
            markdown: { isTrusted: true, supportHtml: true },
          },
          connection: {
            options: {
              $type: 'WorkerDirect',
              worker: new LikeC4LspWorker(),
            },
          },
        },
      },
    },
  }
}
