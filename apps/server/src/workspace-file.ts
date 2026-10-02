import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
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
