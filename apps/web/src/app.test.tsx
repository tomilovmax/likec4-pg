// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { readFakeModel, resetForTest } from './editor/monaco-editor.fake'
import {
  publishDiagnostics,
  readSyncedSources,
  resetLanguageRuntimeForTest,
} from './editor/likec4-language-runtime.fake'

// Monaco и browser LSP не работают в jsdom: подменяются их единственные границы.
vi.mock('./editor/monaco-editor', async () => import('./editor/monaco-editor.fake'))
vi.mock('./editor/likec4-language-runtime', async () => import('./editor/likec4-language-runtime.fake'))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetForTest()
  resetLanguageRuntimeForTest()
})

describe('REQ-01 desktop shell', () => {
  it('shows all three panels after independent API requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/workspace') {
          return Promise.resolve(
            jsonResponse({ status: 'ready', displayName: 'architecture' }),
          )
        }
        if (path === '/api/files') {
          return Promise.resolve(jsonResponse({ items: [] }))
        }
        return Promise.resolve(
          jsonResponse({ status: 'empty', reason: 'NO_WORKSPACE_VIEW' }),
        )
      }),
    )

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })
    const diagram = screen.getByRole('region', { name: 'Diagram' })

    await waitFor(() => {
      expect(within(files).getByText('В workspace нет LikeC4-файлов.')).toBeTruthy()
      expect(
        within(editor).getByText('Выберите файл в панели Files, чтобы открыть его.'),
      ).toBeTruthy()
      expect(
        within(editor).getByText(/Workspace «architecture» готов к работе\./),
      ).toBeTruthy()
      expect(
        within(diagram).getByText('Нет доступной LikeC4 view для отображения.'),
      ).toBeTruthy()
    })
  })

  it('isolates an API failure to Files and retries only that panel', async () => {
    const fetchMock = vi.fn((path: string) => {
      if (path === '/api/files') {
        return Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Files request failed',
              },
            },
            500,
          ),
        )
      }
      if (path === '/api/workspace') {
        return Promise.resolve(
          jsonResponse({ status: 'ready', displayName: 'architecture' }),
        )
      }
      return Promise.resolve(
        jsonResponse({ status: 'empty', reason: 'NO_WORKSPACE_VIEW' }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })
    const diagram = screen.getByRole('region', { name: 'Diagram' })

    await waitFor(() => {
      expect(within(files).getByRole('alert').textContent).toContain('Files request failed')
      expect(
        within(editor).getByText('Выберите файл в панели Files, чтобы открыть его.'),
      ).toBeTruthy()
      expect(
        within(diagram).getByText('Нет доступной LikeC4 view для отображения.'),
      ).toBeTruthy()
    })

    fireEvent.click(within(files).getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([path]) => path === '/api/files')).toHaveLength(2)
    })
  })
})

/** Редактор открытого файла: fake-Monaco рендерит textarea (REQ-05/06). */
function editorTextarea(editor: HTMLElement): HTMLTextAreaElement {
  const textarea = within(editor).getByRole('textbox') as HTMLTextAreaElement
  if (textarea.value === '') {
    throw new Error('Monaco model is not attached yet')
  }
  return textarea
}

const nestedFilesResponse = {
  items: [
    { path: 'model', name: 'model', kind: 'directory' },
    {
      path: 'model/specification.c4',
      name: 'specification.c4',
      kind: 'file',
      language: 'likec4',
    },
    {
      path: 'views/overview.likec4',
      name: 'overview.likec4',
      kind: 'file',
      language: 'likec4',
    },
    { path: 'views', name: 'views', kind: 'directory' },
    {
      path: 'likec4.config.json',
      name: 'likec4.config.json',
      kind: 'file',
      language: 'config',
    },
  ],
}

describe('REQ-04 files panel', () => {

  function stubApi(fetchMock: (path: string) => Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/files') {
          return Promise.resolve(jsonResponse(nestedFilesResponse))
        }
        if (path === '/api/workspace') {
          return Promise.resolve(
            jsonResponse({ status: 'ready', displayName: 'architecture' }),
          )
        }
        return fetchMock(path)
      }),
    )
  }

  it('renders nested directories and visually distinct allowed files', async () => {
    stubApi(() =>
      Promise.resolve(jsonResponse({ status: 'empty', reason: 'NO_WORKSPACE_VIEW' })),
    )

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })

    await waitFor(() => {
      expect(within(files).getByText('model')).toBeTruthy()
      expect(within(files).getByText('views')).toBeTruthy()
    })
    expect(within(files).getByText('specification.c4')).toBeTruthy()
    expect(within(files).getByText('overview.likec4')).toBeTruthy()
    expect(within(files).getByText('likec4.config.json')).toBeTruthy()

    const likec4File = within(files).getByRole('button', {
      name: /specification\.c4/,
    })
    const configFile = within(files).getByRole('button', {
      name: /likec4\.config\.json/,
    })
    expect(likec4File.dataset.language).toBe('likec4')
    expect(configFile.dataset.language).toBe('config')
    expect(within(likec4File).getByText('C4')).toBeTruthy()
    expect(within(configFile).getByText('CFG')).toBeTruthy()
  })

  it('opens the clicked file by its workspace-relative path', async () => {
    stubApi((path) =>
      path === '/api/files/model/specification.c4'
        ? Promise.resolve(
            jsonResponse({
              path: 'model/specification.c4',
              name: 'specification.c4',
              language: 'likec4',
              content: 'model {}',
              version: 'a'.repeat(64),
            }),
          )
        : Promise.reject(new Error(`unexpected fetch: ${path}`)),
    )
    const fetchCalls = vi.mocked(fetch)

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })

    const specification = await waitFor(() =>
      within(files).getByRole('button', { name: /specification\.c4/ }),
    )
    fireEvent.click(specification)

    await waitFor(() => {
      expect(editorTextarea(editor).value).toContain('model {}')
    })
    expect(specification.getAttribute('aria-current')).toBe('true')

    // Открытие и фоновая загрузка полного DSL-набора идут только по
    // относительным API-путям; абсолютный путь хоста браузеру недоступен.
    expect(fetchCalls.mock.calls).toHaveLength(6)
    expect(fetchCalls.mock.calls.every(([path]) => String(path).startsWith('/api/'))).toBe(true)
  })
})

describe('REQ-05 open file', () => {
  const literalContent = '// комментарий\r\nmodel {\r\n  demo = "λ"\r\n}\r\n'

  function stubApiWithFileContent(respond: () => Promise<Response>) {
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/api/files') {
          return Promise.resolve(jsonResponse(nestedFilesResponse))
        }
        if (path === '/api/workspace') {
          return Promise.resolve(
            jsonResponse({ status: 'ready', displayName: 'architecture' }),
          )
        }
        if (path === '/api/diagram') {
          return Promise.resolve(
            jsonResponse({ status: 'empty', reason: 'NO_WORKSPACE_VIEW' }),
          )
        }
        if (path === '/api/files/model/specification.c4') {
          return respond()
        }
        return Promise.reject(new Error(`unexpected fetch: ${path}`))
      }),
    )
  }

  async function openSpecificationFile() {
    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })

    const specification = await waitFor(() =>
      within(files).getByRole('button', { name: /specification\.c4/ }),
    )
    fireEvent.click(specification)

    return { files, editor }
  }

  it('shows the literal UTF-8 text of the opened file without reformatting', async () => {
    stubApiWithFileContent(() =>
      Promise.resolve(
        jsonResponse({
          path: 'model/specification.c4',
          name: 'specification.c4',
          language: 'likec4',
          content: literalContent,
          version: 'ab12cd34ef56'.padEnd(64, '0'),
        }),
      ),
    )

    const { editor } = await openSpecificationFile()

    const textarea = await waitFor(() => editorTextarea(editor))
    // Текст проходит в редактор буквально: CRLF, комментарии и форматирование
    // не меняются, format-on-load отсутствует. textarea.value нормализует CRLF
    // по спецификации HTML, поэтому буквальность проверяется на модели
    // редактора (настоящая Monaco хранит buffer так же).
    expect(readFakeModel('model/specification.c4')).toBe(literalContent)
    expect(textarea.value).toBe(literalContent.replaceAll('\r\n', '\n'))
    expect(within(editor).getByText(/версия ab12cd34ef56/)).toBeTruthy()
  })

  it('isolates an open failure to the editor and retries only the file request', async () => {
    let fileRequests = 0
    stubApiWithFileContent(() => {
      fileRequests += 1
      if (fileRequests === 1) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'NOT_FOUND', message: 'Entry not found in the workspace.' } },
            404,
          ),
        )
      }
      return Promise.resolve(
        jsonResponse({
          path: 'model/specification.c4',
          name: 'specification.c4',
          language: 'likec4',
          content: 'model {}',
          version: 'b'.repeat(64),
        }),
      )
    })

    const { files, editor } = await openSpecificationFile()

    await waitFor(() => {
      expect(within(editor).getByRole('alert').textContent).toContain(
        'Entry not found in the workspace.',
      )
    })
    // Ошибка открытия не ломает остальные панели.
    expect(within(files).getByText('overview.likec4')).toBeTruthy()

    fireEvent.click(within(editor).getByRole('button', { name: 'Повторить' }))

    await waitFor(() => {
      expect(editorTextarea(editor).value).toBe('model {}')
    })
    expect(fileRequests).toBe(2)
  })
})

describe('REQ-06 editor buffer', () => {
  const savedSpecification = 'specification {\n  demo = "λ"\n}'
  const savedOverview = 'view overview {\n}'
  const editedSpecification = 'specification {\n  demo = "edited"\n}'

  function stubApiWithSources(diagram: () => Promise<Response> = () =>
    Promise.resolve(jsonResponse({ status: 'empty', reason: 'NO_WORKSPACE_VIEW' })),
  ) {
    const fetchMock = vi.fn((path: string): Promise<Response> => {
      if (path === '/api/files') {
        return Promise.resolve(jsonResponse(nestedFilesResponse))
      }
      if (path === '/api/workspace') {
        return Promise.resolve(
          jsonResponse({ status: 'ready', displayName: 'architecture' }),
        )
      }
      if (path === '/api/diagram') {
        return diagram()
      }
      if (path === '/api/files/model/specification.c4') {
        return Promise.resolve(
          jsonResponse({
            path: 'model/specification.c4',
            name: 'specification.c4',
            language: 'likec4',
            content: savedSpecification,
            version: 'c'.repeat(64),
          }),
        )
      }
      if (path === '/api/files/views/overview.likec4') {
        return Promise.resolve(
          jsonResponse({
            path: 'views/overview.likec4',
            name: 'overview.likec4',
            language: 'likec4',
            content: savedOverview,
            version: 'd'.repeat(64),
          }),
        )
      }
      return Promise.reject(new Error(`unexpected fetch: ${path}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock }
  }

  async function openFile(files: HTMLElement, name: RegExp) {
    const entry = await waitFor(() => within(files).getByRole('button', { name }))
    fireEvent.click(entry)
  }

  it('marks the edited buffer as unsaved and keeps the saved version visible', async () => {
    stubApiWithSources()

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })

    await openFile(files, /specification\.c4/)

    const textarea = await waitFor(() => editorTextarea(editor))
    expect(textarea.value).toBe(savedSpecification)
    expect(within(editor).queryByText(/не сохранён/)).toBeNull()
    expect(files.querySelector('.file-tree__dirty')).toBeNull()

    fireEvent.change(textarea, { target: { value: editedSpecification } })

    await waitFor(() => {
      expect(within(editor).getByText(/не сохранён/)).toBeTruthy()
    })
    expect(files.querySelector('.file-tree__dirty')).toBeTruthy()
    // Показана версия сохранённого содержимого, а не buffer’а.
    expect(within(editor).getByText(/версия c{12}/)).toBeTruthy()
  })

  it('keeps the unsaved buffer when switching to another file and back', async () => {
    const { fetchMock } = stubApiWithSources()

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })

    await openFile(files, /specification\.c4/)
    const specificationTextarea = await waitFor(() => editorTextarea(editor))
    fireEvent.change(specificationTextarea, { target: { value: editedSpecification } })
    await waitFor(() => {
      expect(within(editor).getByText(/не сохранён/)).toBeTruthy()
    })

    await openFile(files, /overview\.likec4/)
    await waitFor(() => {
      expect(editorTextarea(editor).value).toBe(savedOverview)
    })
    expect(within(editor).queryByText(/не сохранён/)).toBeNull()
    expect(files.querySelectorAll('.file-tree__dirty')).toHaveLength(1)

    await openFile(files, /specification\.c4/)
    await waitFor(() => {
      expect(editorTextarea(editor).value).toBe(editedSpecification)
    })
    await waitFor(() => {
      expect(within(editor).getByText(/не сохранён/)).toBeTruthy()
    })

    // Возврат к файлу не перечитывает его: unsaved buffer не затирается.
    expect(
      fetchMock.mock.calls.filter(([path]) => path === '/api/files/model/specification.c4'),
    ).toHaveLength(1)
  })

  it('stays editable when the diagram preview request fails', async () => {
    stubApiWithSources(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 'INTERNAL_ERROR', message: 'Diagram request failed' } },
          500,
        ),
      ),
    )

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })
    const diagram = screen.getByRole('region', { name: 'Diagram' })

    await openFile(files, /specification\.c4/)

    await waitFor(() => {
      expect(within(diagram).getByRole('alert').textContent).toContain('Diagram request failed')
    })

    const textarea = await waitFor(() => editorTextarea(editor))
    fireEvent.change(textarea, { target: { value: editedSpecification } })
    await waitFor(() => {
      expect(within(editor).getByText(/не сохранён/)).toBeTruthy()
    })
  })

  it('keeps the active editor available when another LikeC4 document has diagnostics', async () => {
    stubApiWithSources()

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })
    await openFile(files, /specification\.c4/)

    await waitFor(() => {
      expect(readSyncedSources().map((source) => source.path).sort()).toEqual([
        'model/specification.c4',
        'views/overview.likec4',
      ])
    })
    expect(editorTextarea(editor).value).toBe(savedSpecification)

    publishDiagnostics({
      'views/overview.likec4': [
        {
          message: 'Unexpected token',
          range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 11 },
          severity: 8,
        },
      ],
    })

    // Ошибка другого документа не заменяет и не блокирует текущий editor.
    fireEvent.change(editorTextarea(editor), { target: { value: editedSpecification } })
    await waitFor(() => {
      expect(within(editor).getByText(/не сохранён/)).toBeTruthy()
    })

    await openFile(files, /overview\.likec4/)
    await waitFor(() => {
      expect(within(editor).getByLabelText('Диагностика LikeC4').textContent).toContain('Unexpected token')
      expect(within(editor).getByText(/строка 2, столбец 3/)).toBeTruthy()
    })
  })

  it('synchronizes an unsaved active LikeC4 buffer into the language workspace', async () => {
    stubApiWithSources()

    render(<App />)

    const files = screen.getByRole('region', { name: 'Files' })
    const editor = screen.getByRole('region', { name: 'Code Editor' })
    await openFile(files, /specification\.c4/)
    await waitFor(() => {
      expect(readSyncedSources()).toHaveLength(2)
    })

    fireEvent.change(editorTextarea(editor), { target: { value: editedSpecification } })

    await waitFor(() => {
      expect(readSyncedSources()).toContainEqual({
        path: 'model/specification.c4',
        content: editedSpecification,
      })
    })
  })
})
