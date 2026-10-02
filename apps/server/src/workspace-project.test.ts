import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkspacePathResolver } from './workspace-paths.js'
import { loadWorkspaceProject } from './workspace-project.js'
import { readWorkspaceFile } from './workspace-file.js'

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
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req14-'))
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

describe('REQ-14 workspace project loader', () => {
  it('loads config, specification, model and views as a single model', async () => {
    const workspaceRoot = await multiFileProject()

    const project = await loadWorkspaceProject(workspaceRoot)

    // Implicit view `index` («Landscape view») добавляется самой версией
    // 1.59.4, когда проект не определяет view с id `index` — официальное
    // поведение discovery, отражаем его как есть.
    expect(project).toEqual({
      status: 'ok',
      views: [
        { id: 'dev-extra', title: 'Dev and Extra' },
        { id: 'index', title: 'Landscape view' },
        { id: 'overview', title: 'Overview' },
      ],
      elements: [
        { id: 'core', kind: 'subsystem', title: 'Core' },
        { id: 'dev', kind: 'requirement', title: 'Dev' },
        { id: 'extra', kind: 'subsystem', title: 'Extra' },
      ],
    })
    expect(JSON.stringify(project)).not.toContain(workspaceRoot)
    expect(JSON.stringify(project)).not.toContain(tmpdir())
  })

  it('keeps the full parsing context when a single file has been opened', async () => {
    const workspaceRoot = await multiFileProject()

    // Открытие одного файла (REQ-05) не влияет на parsing context: модель
    // по-прежнему собирается из всех файлов workspace, включая неоткрытые.
    const opened = await readWorkspaceFile(new WorkspacePathResolver(workspaceRoot), 'model.c4')
    expect(opened.content).toContain("dev = requirement")

    const project = await loadWorkspaceProject(workspaceRoot)
    expect(project.status).toBe('ok')
    if (project.status !== 'ok') {
      return
    }
    expect(project.views.map((view) => view.id)).toContain('dev-extra')
    expect(project.elements.map((element) => element.id)).toContain('extra')

    // Повторная загрузка детерминирована: между чтением файла и парсингом нет общего состояния.
    expect(await loadWorkspaceProject(workspaceRoot)).toEqual(project)
  })

  it('reports invalid DSL with workspace-relative diagnostics only', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req14-'))
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

    const project = await loadWorkspaceProject(workspaceRoot)

    expect(project.status).toBe('invalid')
    if (project.status !== 'invalid') {
      return
    }
    expect(project.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of project.diagnostics) {
      expect(typeof diagnostic.message).toBe('string')
      expect(diagnostic.message.length).toBeGreaterThan(0)
      expect(diagnostic.range.start.line).toBeGreaterThanOrEqual(0)
      if (diagnostic.path !== undefined) {
        expect(path.isAbsolute(diagnostic.path)).toBe(false)
        expect(diagnostic.path.startsWith('..')).toBe(false)
      }
    }
    // Абсолютные пути хоста не покидают backend (принцип REQ-02).
    const serialized = JSON.stringify(project)
    expect(serialized).not.toContain(workspaceRoot)
    expect(serialized).not.toContain(tmpdir())
  })

  it('returns an empty ok model for a workspace without LikeC4 sources', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'likec4-req14-'))
    createdDirectories.push(workspaceRoot)

    const project = await loadWorkspaceProject(workspaceRoot)

    expect(project).toEqual({ status: 'ok', views: [], elements: [] })
  })
})
