import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve as resolveImportMeta } from 'import-meta-resolve'
import { readFile } from 'node:fs/promises'
import url from 'node:url'

export default defineConfig({
  plugins: [react()],
  // Рецепт dev-режима Playground LikeC4 v1.59.4: ES-module worker и единый
  // prebundle LSP-зависимостей, иначе browser language server умирает на
  // разрозненных /@fs/-модулях.
  resolve: {
    dedupe: ['vscode'],
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: [
      '@likec4/language-server/browser',
      '@likec4/language-server/protocol',
      'langium',
      'langium/lsp',
      '@likec4/icons/all',
      '@hpcc-js/wasm-graphviz',
      'p-queue',
      'eventemitter3',
      'word-wrap',
      'picomatch',
      'strip-indent',
      'indent-string',
      'vscode-languageserver/browser',
      'vscode-languageserver-protocol',
      'vscode-languageclient/browser',
      'vscode-languageclient',
      'vscode-languageserver-types',
      'vscode-languageserver',
      'vscode-textmate',
      'vscode-oniguruma',
      'vscode-jsonrpc',
      'vscode-uri',
      'ufo',
    ],
    holdUntilCrawlEnd: false,
    esbuildOptions: {
      plugins: [
        {
          name: 'likec4-codingame-import-meta-url',
          setup({ onLoad }) {
            onLoad({ filter: /.*@codingame.*\.js$/, namespace: 'file' }, async (args) => {
              const code = await readFile(args.path, 'utf8')
              const assetImportMetaUrl = /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/g
              let cursor = 0
              let transformed = ''
              for (let match = assetImportMetaUrl.exec(code); match !== null; match = assetImportMetaUrl.exec(code)) {
                transformed += code.slice(cursor, match.index)
                const sourcePath = match[1]?.slice(1, -1)
                if (sourcePath === undefined) continue
                const resolved = resolveImportMeta(sourcePath, url.pathToFileURL(args.path).toString())
                transformed += `new URL(${JSON.stringify(url.fileURLToPath(resolved))}, import.meta.url)`
                cursor = assetImportMetaUrl.lastIndex
              }
              return { contents: transformed + code.slice(cursor) }
            })
          },
        },
        {
          name: 'likec4-strip-vscode-textmate-sourcemap',
          setup({ onLoad }) {
            onLoad({ filter: /vscode-textmate.*[\\/]release[\\/]main\.js$/, namespace: 'file' }, async (args) => ({
              contents: (await readFile(args.path, 'utf8')).replace(/\n?\/\/# sourceMappingURL=.*$/m, ''),
              loader: 'js',
            }))
          },
        },
      ],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  }
})
