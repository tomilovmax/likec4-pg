# LikeC4 Web IDE

Self-hosted browser IDE для одного LikeC4 workspace. Реализованы REQ-01 (трёхпанельный app shell: Files, Code Editor, Diagram на одном URL) и REQ-02 (настроенный и проверенный workspace).

Browser получает данные только через backend HTTP API. Он не получает прямой доступ к файловой системе хоста и не может выбрать другой workspace: путь задаёт только оператор на сервере.

## Быстрый старт

Требования: Node.js `22.23.3` или новее и npm.

```bash
npm install
```

Запуск в dev-режиме (web на `http://localhost:3000`, backend на `:3001`, прокси `/api`):

```bash
npm run dev
```

По умолчанию dev-режим использует каталог `apps/server/dev-workspace`. Чтобы работать со своим проектом:

```bash
LIKEC4_WORKSPACE=/path/to/likec4/project npm run dev
```

Production-запуск собранного приложения:

```bash
npm run build
LIKEC4_WORKSPACE=/path/to/likec4/project PORT=3000 npm start
```

## Конфигурация backend

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `LIKEC4_WORKSPACE` | нет (обязательна) | Единственный filesystem root приложения. Каталог должен существовать и быть читаемым; при пустом, отсутствующем или недоступном значении startup завершается понятной ошибкой, а HTTP API не даёт способа выбрать иной путь. |
| `PORT` | `3000` | TCP порт backend. Непривилегированное безопасное значение по умолчанию; принимаются значения `1–65535`. |

Проверить настроенный workspace (ответ содержит только безопасные сведения — статус и display name, без абсолютного пути хоста):

```bash
curl http://localhost:3000/api/workspace
# {"status":"ready","displayName":"likec4-project"}
```

## Текущее состояние

REQ-01 предоставляет трёхпанельный app shell и независимые loading/empty/error состояния панелей. REQ-02 добавляет server-side конфигурацию: сервер стартует только с существующим читаемым каталогом из `LIKEC4_WORKSPACE` и использует его как единственный filesystem root. `GET /api/files` и `GET /api/diagram` пока возвращают безопасные placeholder-ответы: дерево файлов, редактор LikeC4, parsing и diagram preview будут добавляться отдельными требованиями.

MVP не включает Git, authentication, database, collaboration, history, AI, Kubernetes или CI/CD deployment.

## Проверка

```bash
npm run typecheck
npm run lint
npm test
```

Одиночный тест: `npx vitest run apps/server/src/config.test.ts`; конкретный сценарий: `npx vitest run -t 'rejects a missing directory'`.

## Upstream LikeC4

Архитектурные решения и перечень официальных компонентов LikeC4, которые будут переиспользованы, зафиксированы в [docs/architecture.md](docs/architecture.md). В частности, будущий diagram использует публичный `@likec4/diagram`, а официальные Playground patterns задают ориентир для editor/LSP integration. Приложение не реализует собственные LikeC4 parser, renderer или syntax checker.
