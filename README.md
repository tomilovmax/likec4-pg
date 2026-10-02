# LikeC4 Web IDE

Self-hosted browser IDE для одного LikeC4 workspace. Этот репозиторий начинает реализацию с REQ-01: на одном URL доступны панели **Files**, **Code Editor** и **Diagram**.

Browser получает данные только через backend HTTP API. Он не получает прямой доступ к файловой системе хоста.

## Быстрый старт

Требования: Node.js `22.23.3` или новее и npm.

```bash
npm install
```

Запуск приложения:

```bash
npm run dev
```

Откройте <http://localhost:3000>.

## Текущее состояние

REQ-01 предоставляет трёхпанельный app shell и безопасные пустые API-ответы. Настройка workspace, доступ к файлам, редактор LikeC4, parsing и diagram preview будут добавляться отдельными требованиями.

MVP не включает Git, authentication, database, collaboration, history, AI, Kubernetes или CI/CD deployment.

## Upstream LikeC4

Архитектурные решения и перечень официальных компонентов LikeC4, которые будут переиспользованы, зафиксированы в [docs/architecture.md](docs/architecture.md). В частности, будущий diagram использует публичный `@likec4/diagram`, а официальные Playground patterns задают ориентир для editor/LSP integration. Приложение не реализует собственные LikeC4 parser, renderer или syntax checker.
