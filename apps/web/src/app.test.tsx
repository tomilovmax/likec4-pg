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
            jsonResponse({ status: 'unconfigured', displayName: 'Workspace' }),
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
      expect(within(files).getByText('В workspace пока нет файлов.')).toBeTruthy()
      expect(
        within(editor).getByText('Выберите файл в панели Files, чтобы открыть его.'),
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
          jsonResponse({ status: 'unconfigured', displayName: 'Workspace' }),
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
