import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LikeC4Model } from '@likec4/core/model'

import { loadWorkspaceDiagram } from './workspace-diagram.js'

const createdDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

/** Multi-file LikeC4-проект: config + specification + model + views, включая вложенные каталоги и cross-file references. */
async function multiFileProject(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req15-'))
  createdDirectories.push(workspaceRoot)
  await mkdir(path.join(workspaceRoot, 'model'))
  await mkdir(path.join(workspaceRoot, 'views'))
  await writeFile(
    path.join(workspaceRoot, 'likec4.config.json'),
    '{"name":"fixture"}',
    'utf8',
  )
  await writeFile(
    path.join(workspaceRoot, 'specification.c4'),
    `
specification {
  element requirement
  element subsystem
}
`,
    'utf8',
  )
  await writeFile(
    path.join(workspaceRoot, 'model.c4'),
    `
model {
  dev = requirement {
    title 'Dev'
  }
  core = subsystem {
    title 'Core'
    -> dev 'реализует'
  }
}
`,
    'utf8',
  )
  // Вложенный каталог модели: `dev` определён в model.c4 — cross-file reference.
  await writeFile(
    path.join(workspaceRoot, 'model/extra.c4'),
    `
model {
  extra = subsystem {
    title 'Extra'
    -> dev 'расширяет'
  }
}
`,
    'utf8',
  )
  await writeFile(
    path.join(workspaceRoot, 'views.c4'),
    `
views {
  view overview {
    title 'Overview'
    include *
  }
}
`,
    'utf8',
  )
  // Вторая view из вложенного каталога: include ссылается на элементы из разных файлов.
  await writeFile(
    path.join(workspaceRoot, 'views/extra.c4'),
    `
views {
  view dev-extra {
    title 'Dev and Extra'
    include dev, extra
  }
}
`,
    'utf8',
  )
  return workspaceRoot
}

describe('REQ-15 workspace diagram loader', () => {
  it('loads a ready layouted model built from all workspace files', async () => {
    const workspaceRoot = await multiFileProject()

    const diagram = await loadWorkspaceDiagram(workspaceRoot)

    expect(diagram.status).toBe('ready')
    if (diagram.status !== 'ready') {
      return
    }
    // Implicit view `index` («Landscape view») добавляется версией 1.59.4 —
    // официальное поведение discovery (см. REQ-14).
    expect(diagram.views).toEqual([
      { id: 'dev-extra', title: 'Dev and Extra' },
      { id: 'index', title: 'Landscape view' },
      { id: 'overview', title: 'Overview' },
    ])
    expect(diagram.defaultViewId).toBe('index')
    // Модель прошла layout: готова к renderer'у, а не только к спискам REQ-14.
    expect(diagram.model._stage).toBe('layouted')
    // Диаграмма строится из multi-file модели: view из вложенного каталога,
    // ни один файл которого не «открывался», присутствует в layouted-данных.
    expect(Object.keys(diagram.model.views)).toContain('dev-extra')

    // Абсолютные пути хоста не покидают backend (принцип REQ-02).
    const serialized = JSON.stringify(diagram)
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain(tmpdir())
  })

  it('produces model data the browser renderer can consume', async () => {
    const workspaceRoot = await multiFileProject()

    const diagram = await loadWorkspaceDiagram(workspaceRoot)

    expect(diagram.status).toBe('ready')
    if (diagram.status !== 'ready') {
      return
    }
    // HTTP передаёт модель как чистый JSON. Round-trip через официальную
    // фабрику клиента: если формат $data перестанет переживать сериализацию
    // или LikeC4Model.create, тест падает раньше рендера в браузере.
    const restored = LikeC4Model.create(
      JSON.parse(JSON.stringify(diagram.model)) as Parameters<
        typeof LikeC4Model.create
      >[0],
    )
    expect(restored.findView('index')).not.toBeNull()
    expect([...restored.views()].map((view) => view.id as string)).toEqual(
      expect.arrayContaining(['dev-extra', 'index', 'overview']),
    )
  })

  it('reports invalid DSL instead of a half layouted model', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req15-'))
    createdDirectories.push(workspaceRoot)
    await writeFile(
      path.join(workspaceRoot, 'broken.c4'),
      `
model {
  missing = nowhere {
}
`,
      'utf8',
    )

    const diagram = await loadWorkspaceDiagram(workspaceRoot)

    // layoutedModel() при ошибках всё равно вернул бы половинную модель с
    // implicit view — сервер обязан не отдавать её как актуальную (REQ-14/18).
    expect(diagram.status).toBe('invalid')
    if (diagram.status !== 'invalid') {
      return
    }
    expect(diagram.diagnostics.length).toBeGreaterThan(0)
    expect('model' in diagram).toBe(false)
    for (const diagnostic of diagram.diagnostics) {
      if (diagnostic.path !== undefined) {
        expect(path.isAbsolute(diagnostic.path)).toBe(false)
      }
    }
    const serialized = JSON.stringify(diagram)
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain(tmpdir())
  })

  it('returns an empty state for a workspace without LikeC4 sources', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req15-'))
    createdDirectories.push(workspaceRoot)

    const diagram = await loadWorkspaceDiagram(workspaceRoot)

    expect(diagram).toEqual({ status: 'empty', reason: 'NO_VIEWS' })
  })

  it('prefers an explicitly defined index view as the default', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req15-'))
    createdDirectories.push(workspaceRoot)
    await writeFile(
      path.join(workspaceRoot, 'specification.c4'),
      `
specification {
  element subsystem
}
`,
      'utf8',
    )
    await writeFile(
      path.join(workspaceRoot, 'model.c4'),
      `
model {
  core = subsystem {
    title 'Core'
  }
}
`,
      'utf8',
    )
    await writeFile(
      path.join(workspaceRoot, 'views.c4'),
      `
views {
  view index {
    title 'Custom Index'
    include *
  }
}
`,
      'utf8',
    )

    const diagram = await loadWorkspaceDiagram(workspaceRoot)

    expect(diagram.status).toBe('ready')
    if (diagram.status !== 'ready') {
      return
    }
    expect(diagram.views).toEqual([{ id: 'index', title: 'Custom Index' }])
    expect(diagram.defaultViewId).toBe('index')
  })
})
