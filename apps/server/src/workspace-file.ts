import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  CreateDirectoryResponse,
  FileContentResponse,
} from '@likec4-web-ide/contracts'

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

export interface CreateWorkspaceFileInput {
  /** Workspace-относительный путь существующего каталога; '' — корень workspace. */
  parent: string
  /** Базовое имя создаваемого файла. */
  name: string
}

export interface CreateWorkspaceDirectoryInput {
  /** Workspace-относительный путь существующего каталога; '' — корень workspace. */
  parent: string
  /** Базовое имя создаваемого каталога. */
  name: string
}

/**
 * Создание нового .c4 файла (REQ-08). Имя — строго базовое имя с расширением
 * `.c4`: это подмножество классификатора REQ-04, поэтому созданный файл
 * гарантированно попадает в дерево и открывается как редактируемый LikeC4
 * исходник. Каталог назначения резолвится как существующая запись, цель —
 * через `resolveChild` guard’а REQ-03 (realpath parent, а для уже занятого
 * имени — и realpath цели), поэтому traversal, symlink наружу и отсутствующий
 * parent отклоняются до записи.
 *
 * Файл не перезаписывает существующие записи: `writeFile` с флагом `wx` —
 * атомарный create-if-not-exists, занятое имя (файл или каталог) даёт
 * `409 CONFLICT` без единого байта записи; гонка двух одинаковых запросов
 * завершается ровно одним успехом. Создаётся пустой literal-файл — version
 * token ответа это sha256 пустого содержимого, той же схемой, что у чтения.
 */
export async function createWorkspaceFile(
  resolver: WorkspacePathResolver,
  input: CreateWorkspaceFileInput,
): Promise<FileContentResponse> {
  const name = validateNewFileName(input.name)
  const parentPath = await resolveParentDirectory(resolver, input.parent)

  const resolved = await resolver.resolveChild(
    parentPath === '' ? name : `${parentPath}/${name}`,
  )

  const bytes = Buffer.alloc(0)
  try {
    await writeFile(resolved.absolutePath, bytes, { flag: 'wx', mode: 0o644 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new ApiError(
        409,
        'CONFLICT',
        `Entry "${name}" already exists in this directory.`,
      )
    }
    if (code === 'ENOENT') {
      // Parent исчез между resolve и записью — это не 500 и не перезапись.
      throw new ApiError(404, 'NOT_FOUND', 'Parent directory not found in the workspace.')
    }
    throw error
  }

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    language: 'likec4',
    content: '',
    version: contentVersion(bytes),
  }
}

/**
 * Создание одного нового каталога (REQ-09). Имя — базовое имя записи без
 * path-семантики и без ведущей точки: скрытый каталог невидим для фильтра
 * дерева (REQ-04), поэтому его создание нарушало бы критерий «новый каталог
 * появляется в дереве» — имя отклоняется до записи. Каталог назначения
 * резолвится тем же `resolveParentDirectory`, цель — через `resolveChild`
 * guard’а REQ-03 (realpath parent, а для занятого имени — и realpath цели),
 * поэтому traversal, symlink наружу и отсутствующий parent отклоняются
 * до записи.
 *
 * `mkdir` без recursion создаёт ровно один каталог в существующем parent —
 * произвольный путь не создаётся; `EEXIST` отдаёт `409 CONFLICT` без
 * единого изменения на диске, `ENOENT` (parent исчез между resolve и записью) —
 * `404`. Ответ — entry каталога: содержимого и version token нет.
 */
export async function createWorkspaceDirectory(
  resolver: WorkspacePathResolver,
  input: CreateWorkspaceDirectoryInput,
): Promise<CreateDirectoryResponse> {
  const name = validateNewDirectoryName(input.name)
  const parentPath = await resolveParentDirectory(resolver, input.parent)

  const resolved = await resolver.resolveChild(
    parentPath === '' ? name : `${parentPath}/${name}`,
  )

  try {
    await mkdir(resolved.absolutePath, { recursive: false, mode: 0o755 })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new ApiError(
        409,
        'CONFLICT',
        `Entry "${name}" already exists in this directory.`,
      )
    }
    if (code === 'ENOENT') {
      // Parent исчез между resolve и записью — это не 500 и не перезапись.
      throw new ApiError(404, 'NOT_FOUND', 'Parent directory not found in the workspace.')
    }
    throw error
  }

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    kind: 'directory',
  }
}

/**
 * Каталог назначения новой записи (REQ-08/09): '' — доверенный корень,
 * иначе путь проходит `resolveExisting` guard’а REQ-03 и обязан быть
 * каталогом. Отсутствующий parent — 404 из resolver’а, файл — 400.
 */
async function resolveParentDirectory(
  resolver: WorkspacePathResolver,
  parent: string,
): Promise<string> {
  if (parent === '') {
    return ''
  }
  const resolved = await resolver.resolveExisting(parent)
  const stats = await stat(resolved.absolutePath)
  if (!stats.isDirectory()) {
    throw new ApiError(
      400,
      'INVALID_PATH',
      'Parent must be a directory inside the workspace.',
    )
  }
  return resolved.relativePath
}

/** Имя нового файла: одиночная запись с расширением .c4, без path-семантики. */
function validateNewFileName(rawName: string): string {
  const name = validateEntryName(rawName, 'File')
  if (!name.endsWith('.c4')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Only new .c4 files can be created.')
  }
  return name
}

/** Имя нового каталога: одиночная запись без ведущей точки. */
function validateNewDirectoryName(rawName: string): string {
  const name = validateEntryName(rawName, 'Directory')
  if (name.startsWith('.')) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Directory name cannot start with a dot — hidden entries are not shown in the tree.',
    )
  }
  return name
}

/** Общее правило REQ-08/09: имя записи — не путь и не пустая строка. */
function validateEntryName(rawName: string, kind: 'File' | 'Directory'): string {
  const name = rawName.trim()
  if (name === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${kind} name is required.`)
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..'
  ) {
    throw new ApiError(
      400,
      'INVALID_PATH',
      `${kind} name must be a single entry name, not a path.`,
    )
  }
  if (Buffer.byteLength(name, 'utf8') > 255) {
    throw new ApiError(400, 'INVALID_PATH', `${kind} name is too long.`)
  }
  return name
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
