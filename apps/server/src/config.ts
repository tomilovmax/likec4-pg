import { access, constants, stat } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_PORT = 3000

export interface ServerConfig {
  workspaceRoot: string
  port: number
}

export class ServerConfigError extends Error {}

export async function loadServerConfig(
  env: NodeJS.ProcessEnv,
): Promise<ServerConfig> {
  const port = parsePort(env.PORT)
  const workspaceRoot = await resolveWorkspaceRoot(env.LIKEC4_WORKSPACE)
  return { workspaceRoot, port }
}

function parsePort(raw: string | undefined): number {
  const configured = raw?.trim() ?? ''
  if (configured === '') {
    return DEFAULT_PORT
  }

  const port = Number.parseInt(configured, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ServerConfigError(
      `PORT "${configured}" is not a valid TCP port (expected 1-65535).`,
    )
  }
  return port
}

async function resolveWorkspaceRoot(
  raw: string | undefined,
): Promise<string> {
  const configured = raw?.trim() ?? ''
  if (configured === '') {
    throw new ServerConfigError(
      'LIKEC4_WORKSPACE is not set. Point it to an existing readable directory.',
    )
  }

  // Сообщения ошибок называют только значение оператора, а не resolved-путь хоста.
  const workspaceRoot = path.resolve(configured)

  let rootStats
  try {
    rootStats = await stat(workspaceRoot)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ServerConfigError(
        `LIKEC4_WORKSPACE "${configured}" does not exist or is not a directory.`,
      )
    }
    throw new ServerConfigError(
      `LIKEC4_WORKSPACE "${configured}" is not accessible.`,
    )
  }

  if (!rootStats.isDirectory()) {
    throw new ServerConfigError(
      `LIKEC4_WORKSPACE "${configured}" does not exist or is not a directory.`,
    )
  }

  try {
    await access(workspaceRoot, constants.R_OK)
  } catch {
    throw new ServerConfigError(
      `LIKEC4_WORKSPACE "${configured}" is not readable by this process.`,
    )
  }

  return workspaceRoot
}
