import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { ApiError } from './http/api-error.js'

export interface ResolvedWorkspacePath {
  /** Абсолютный путь хоста. Живёт только внутри backend и не попадает в HTTP response. */
  absolutePath: string
  /** Нормализованный относительный путь внутри workspace — то, что можно показывать клиенту. */
  relativePath: string
}

/**
 * Единственный path guard файловых операций (REQ-03). Операции list, read,
 * write, create, mkdir, rename и delete принимают от клиента только
 * относительный путь и резолвят его через этот resolver:
 * - read, delete и источник rename — `resolveExisting` (realpath самой записи);
 * - write, create, mkdir и назначение rename — `resolveChild` (realpath parent,
 *   а для уже существующей записи — и её realpath).
 *
 * Проверка двух уровней:
 * 1. лексическая — путь проверяется после URL-decoding (параметры Fastify
 *    приходят уже декодированными) и после нормализации: `..`, абсолютные
 *    пути (posix и windows), NUL и `\` отклоняются до любого обращения к fs;
 * 2. физическая — realpath проверяемой цели обязан находиться внутри realpath
 *    workspace root, поэтому symlink наружу не проходит; внутренние symlink
 *    разрешены.
 *
 * Сообщения об ошибках называют только путь, присланный клиентом: абсолютные
 * пути хоста, realpath-цели и содержимое внешних файлов не раскрываются.
 */
export class WorkspacePathResolver {
  private rootRealPathPromise: Promise<string> | undefined

  constructor(private readonly workspaceRoot: string) {}

  async resolveExisting(userPath: string): Promise<ResolvedWorkspacePath> {
    const candidate = this.lexicallyConfined(userPath)
    const realPath = await this.realpathWithinRoot(candidate, userPath)
    return {
      absolutePath: realPath,
      relativePath: toRelative(await this.trustedRoot(), realPath),
    }
  }

  async resolveChild(userPath: string): Promise<ResolvedWorkspacePath> {
    const candidate = this.lexicallyConfined(userPath)

    const name = path.basename(candidate)
    const realParent = await this.realpathWithinRoot(
      path.dirname(candidate),
      userPath,
    )

    // Создаваемая запись может уже существовать (перезапись, symlink);
    // тогда её фактическая цель тоже обязана быть внутри workspace.
    await this.realpathIfExistsWithinRoot(candidate, userPath)

    const relativeParent = toRelative(await this.trustedRoot(), realParent)
    return {
      absolutePath: path.join(realParent, name),
      // Для корня toRelative даёт '', и слэш не подставляется.
      relativePath: relativeParent === '' ? name : `${relativeParent}/${name}`,
    }
  }

  private lexicallyConfined(userPath: string): string {
    if (typeof userPath !== 'string' || userPath.trim() === '') {
      throw new ApiError(400, 'INVALID_PATH', 'Relative path is required.')
    }
    if (path.isAbsolute(userPath) || path.win32.isAbsolute(userPath)) {
      throw pathOutsideWorkspace(userPath)
    }
    if (userPath.includes('\0') || userPath.includes('\\')) {
      throw new ApiError(
        400,
        'INVALID_PATH',
        'Path contains forbidden characters.',
      )
    }

    const candidate = path.normalize(path.join(this.workspaceRoot, userPath))
    if (candidate === this.workspaceRoot) {
      // Путь обозначает сам workspace, а не запись в нём.
      throw new ApiError(
        400,
        'INVALID_PATH',
        'Path must name an entry inside the workspace.',
      )
    }
    if (!isWithin(this.workspaceRoot, candidate)) {
      throw pathOutsideWorkspace(userPath)
    }
    return candidate
  }

  private async realpathWithinRoot(
    absolutePath: string,
    userPath: string,
  ): Promise<string> {
    let realPath: string
    try {
      realPath = await realpath(absolutePath)
    } catch (error) {
      throw toRealpathApiError(error)
    }

    const root = await this.trustedRoot()
    if (!isWithin(root, realPath)) {
      throw pathOutsideWorkspace(userPath)
    }
    return realPath
  }

  private async realpathIfExistsWithinRoot(
    absolutePath: string,
    userPath: string,
  ): Promise<void> {
    try {
      await this.realpathWithinRoot(absolutePath, userPath)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        // Создаваемая запись ещё не существует — достаточно проверки parent.
        return
      }
      throw error
    }
  }

  /** realpath workspace root — доверенная точка отсчёта для обхода дерева (REQ-04). */
  trustedRoot(): Promise<string> {
    this.rootRealPathPromise ??= realpath(this.workspaceRoot)
    return this.rootRealPathPromise
  }
}

export function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

function toRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}

function pathOutsideWorkspace(userPath: string): ApiError {
  return new ApiError(
    403,
    'PATH_OUTSIDE_WORKSPACE',
    `Path "${userPath}" is outside the workspace.`,
  )
}

function toRealpathApiError(error: unknown): ApiError {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new ApiError(404, 'NOT_FOUND', 'Entry not found in the workspace.')
  }
  // EACCES и прочие ошибки fs уходят в общий 500 без деталей пути.
  throw error
}
