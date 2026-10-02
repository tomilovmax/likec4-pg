import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { LocalWorkspaceProvider } from './adapters/local-workspace.js'
import { buildApp } from './app.js'
import { loadServerConfig, ServerConfigError, type ServerConfig } from './config.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const staticRoot = path.resolve(currentDirectory, '../../web/dist')

let config: ServerConfig
try {
  config = await loadServerConfig(process.env)
} catch (error) {
  const message =
    error instanceof ServerConfigError
      ? error.message
      : 'Unexpected startup error'
  console.error(message)
  process.exit(1)
}

const workspace = new LocalWorkspaceProvider(config.workspaceRoot)
const app = await buildApp({
  // dev-режим может стартовать до первой сборки web, поэтому отдаём статику только если она собрана
  ...(existsSync(staticRoot) ? { staticRoot } : {}),
  workspace,
})

try {
  await app.listen({ host: '0.0.0.0', port: config.port })
  console.log(`LikeC4 Web IDE listening on http://localhost:${config.port}`)
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
