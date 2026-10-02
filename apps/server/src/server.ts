import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { buildApp } from './app.js'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const staticRoot = path.resolve(currentDirectory, '../../web/dist')
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

const app = await buildApp({ staticRoot })

try {
  await app.listen({ host: '0.0.0.0', port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
