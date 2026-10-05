import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { FileContentResponse } from '@likec4-web-ide/contracts'

import { classifyWorkspaceFile } from './domain/allowed-files.js'
import { ApiError } from './http/api-error.js'
import type { WorkspacePathResolver } from './workspace-paths.js'

/**
 * Чтение разрешённого файла workspace (REQ-05). Путь проходит только через
 * общий guard REQ-03 (`resolveExisting`: realpath цели внутри workspace),
 * поэтому traversal, абсолютные пути и symlink наружу отклоняются до
 * открытия файла. Тип проверяется общим классификатором REQ-04
 * (`allowed-files.ts`) по базовому имени запрошенного пути — по тому же
 * правилу, по которому файл попал в дерево, поэтому список и чтение не
 * расходятся: файл либо разрешён обоим, либо обоим запрещён.
 *
 * Содержимое не преобразуется: bytes декодируются строгим UTF-8 decoder’ом
 * (BOM и CRLF сохраняются) и уходят клиенту буквальным текстом, а version —
 * sha256 от исходных bytes, стабильный для одинакового содержимого и
 * меняющийся при любом изменении файла. Абсолютные пути хоста в ответе
 * отсутствуют: клиент видит только workspace-относительный путь.
 */
export async function readWorkspaceFile(
  resolver: WorkspacePathResolver,
  userPath: string,
): Promise<FileContentResponse> {
  const resolved = await resolver.resolveExisting(userPath)

  const stats = await stat(resolved.absolutePath)
  if (!stats.isFile()) {
    throw new ApiError(
      400,
      'INVALID_PATH',
      'Path must name a file inside the workspace.',
    )
  }

  // Классификация по запрошенному имени — то же правило, что фильтрует дерево.
  const requestedName = path.basename(userPath)
  const language = classifyWorkspaceFile(requestedName)
  if (language === undefined) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `File "${requestedName}" is not an editable LikeC4 file.`,
    )
  }

  const bytes = await readFile(resolved.absolutePath)
  const content = decodeLiteralUtf8(bytes, requestedName)

  return {
    // Для внутреннего symlink клиенту отдаётся реальный относительный путь
    // (контракт resolver’а REQ-03).
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    language,
    content,
    version: createHash('sha256').update(bytes).digest('hex'),
  }
}

/** Бинарное или не-UTF-8 содержимое не выдаётся как редактируемый текст. */
function decodeLiteralUtf8(bytes: Buffer, fileName: string): string {
  if (bytes.includes(0)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `File "${fileName}" is binary and cannot be opened as text.`,
    )
  }
  try {
    // ignoreBOM сохраняет BOM в тексте, fatal отвергает невалидные
    // последовательности — содержимое проходит без каких-либо преобразований.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    )
  } catch {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `File "${fileName}" is not valid UTF-8 text.`,
    )
  }
}

export interface SaveWorkspaceFileInput {
  /** Буквальный text buffer, который пользователь редактирует (REQ-06). */
  content: string
  /** Version token, прочитанный при открытии файла (REQ-05). */
  version: string
}

/**
 * Атомарное сохранение literal text buffer (REQ-07). Путь и тип проходят тот же
 * guard REQ-03 и тот же классификатор REQ-04, что и чтение, поэтому записать
 * нельзя ни за пределы workspace, ни файл, который не открывается как
 * редактируемый DSL.
 *
 * Optimistic save: текущие bytes перечитываются и их sha256 сравнивается с
 * присланным version. Несовпадение означает, что файл изменился вне IDE —
 * last-write-wins здесь не допускается, файл не трогается, а клиент получает
 * 409 CONFLICT и сохраняет свой buffer.
 *
 * Запись атомарна: буфер уходит во временный файл в том же каталоге, затем
 * `rename` заменяет цель одним шагом атомарно. Любая ошибка до rename оставляет
 * исходный файл нетронутым, временный файл удаляется. Текст кодируется в
 * UTF-8 буквально: сериализация распарсенной LikeC4 model не используется.
 */
export async function saveWorkspaceFile(
  resolver: WorkspacePathResolver,
  userPath: string,
  input: SaveWorkspaceFileInput,
): Promise<FileContentResponse> {
  const resolved = await resolver.resolveExisting(userPath)

  const stats = await stat(resolved.absolutePath)
  if (!stats.isFile()) {
    throw new ApiError(
      400,
      'INVALID_PATH',
      'Path must name a file inside the workspace.',
    )
  }

  // Классификация по запрошенному имени — ровно то же правило, что фильтрует
  // дерево и разрешает чтение: сохранить нельзя то, что нельзя открыть.
  const requestedName = path.basename(userPath)
  const language = classifyWorkspaceFile(requestedName)
  if (language === undefined) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `File "${requestedName}" is not an editable LikeC4 file.`,
    )
  }

  const currentBytes = await readFile(resolved.absolutePath)
  if (contentVersion(currentBytes) !== input.version) {
    throw new ApiError(
      409,
      'CONFLICT',
      `File "${requestedName}" changed on disk since it was opened.`,
    )
  }

  // Текст, полученный от пользователя, — литеральный source of truth: NUL и
  // прочие управляющие байты не молча искажаются, а отвергаются тем же
  // правилом, что запрещает открытие бинарного файла как текста.
  const bytes = Buffer.from(input.content, 'utf8')
  if (bytes.includes(0)) {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      `Content for "${requestedName}" is not valid UTF-8 text.`,
    )
  }

  await writeAtomically(resolved.absolutePath, bytes, stats.mode)

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    language,
    content: input.content,
    version: contentVersion(bytes),
  }
}

/**
 * Замена файла одним rename: читатель никогда не видит частично записанный
 * target. Временное имя лежит в том же каталоге, поэтому rename атомарен в
 * пределах filesystem и не затрагивает другие тома.
 */
async function writeAtomically(
  absolutePath: string,
  bytes: Buffer,
  mode: number,
): Promise<void> {
  // Имя не пересекается с реальными .c4/.likec4: оно и не проходит
  // классификатор, и показывается в дереве только при сбое записи.
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.likec4-save-${randomUUID()}.tmp`,
  )

  try {
    // mode исходного файла переносится на temp, чтобы replace не сменил
    // права workspace-файла (rename заменяет inode вместе с атрибутами).
    await writeFile(temporaryPath, bytes, { mode: mode & 0o777 })
    await rename(temporaryPath, absolutePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function contentVersion(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
