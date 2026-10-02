// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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

/** Буквальный code view открытого файла (REQ-05). */
function openedCode(editor: HTMLElement): HTMLElement | null {
  return editor.querySelector('.opened-file__code')
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
      expect(openedCode(editor)?.textContent).toContain('model {}')
    })
    expect(specification.getAttribute('aria-current')).toBe('true')

    // Открытие идёт по относительному пути: единственный новый запрос —
    // чтение файла, абсолютный путь хоста браузеру недоступен.
    expect(fetchCalls.mock.calls).toHaveLength(4)
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

    const code = await waitFor(() => {
      const element = openedCode(editor)
      expect(element).toBeTruthy()
      return element as HTMLElement
    })
    // Текст проходит в редактор буквально: CRLF, комментарии и форматирование
    // не меняются, format-on-load отсутствует.
    expect(code.textContent).toBe(literalContent)
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
      expect(openedCode(editor)?.textContent).toBe('model {}')
    })
    expect(fileRequests).toBe(2)
  })
})
