import { execFile, type ExecFileException } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const serverEntry = path.resolve(currentDirectory, 'server.ts')
const repoRoot = path.resolve(currentDirectory, '../../..')
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

async function startServer(
  env: NodeJS.ProcessEnv,
): Promise<ExecFileException | null> {
  return execFileAsync(process.execPath, [tsxCli, serverEntry], {
    env,
    timeout: 60_000,
  }).then(
    () => null,
    (error: ExecFileException) => error,
  )
}

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.LIKEC4_WORKSPACE
  delete env.PORT
  return env
}

describe('REQ-02 startup', () => {
  it('exits with a clear error when LIKEC4_WORKSPACE is not set', async () => {
    const failure = await startServer(baseEnv())

    expect(failure, 'сервер должен был завершиться с ошибкой').not.toBeNull()
    expect(failure?.code).toBe(1)
    expect(failure?.stderr).toContain('LIKEC4_WORKSPACE is not set')
  })

  it('exits with a clear error when the workspace directory is missing', async () => {
    const missing = path.join(path.sep, 'likec4-req02-definitely-missing')
    const failure = await startServer({
      ...baseEnv(),
      LIKEC4_WORKSPACE: missing,
    })

    expect(failure, 'сервер должен был завершиться с ошибкой').not.toBeNull()
    expect(failure?.code).toBe(1)
    expect(failure?.stderr).toContain(`LIKEC4_WORKSPACE "${missing}"`)
    expect(failure?.stderr).not.toContain(path.resolve(currentDirectory))
  })
})
