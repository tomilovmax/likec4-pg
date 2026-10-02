# Архитектура

## Назначение

Приложение — self-hosted browser IDE для одного server-configured LikeC4 workspace. Браузер получает данные только через HTTP API backend и не имеет доступа к файловой системе хоста.

## Upstream LikeC4

На старте проверен upstream LikeC4 [`v1.59.4`](https://github.com/likec4/likec4/tree/v1.59.4), commit [`33dbc2d34c399a99daf96e92fc28fe5d280a7fd5`](https://github.com/likec4/likec4/commit/33dbc2d34c399a99daf96e92fc28fe5d280a7fd5). Официальный Playground — визуальный и функциональный ориентир, но не зависимость приложения.

| Потребность | Upstream-компонент | Решение |
| --- | --- | --- |
| Diagram preview | [`@likec4/diagram`](https://github.com/likec4/likec4/tree/v1.59.4/packages/diagram) | В REQ-15 использовать публичные `LikeC4ModelProvider` и `LikeC4Diagram` (либо `LikeC4View`) с `LikeC4Model.Layouted` и `@likec4/diagram/styles.css`. Самописный SVG/canvas renderer не допускается. |
| IDE UX и интеграционный паттерн | [`apps/playground`](https://github.com/likec4/likec4/tree/v1.59.4/apps/playground) | Использовать как ориентир для трёхпанельного layout, Monaco/LSP boundary, diagnostics и diagram callbacks. Cloudflare Worker, auth, sharing и KV не переносятся. |
| SPA patterns | [`packages/likec4-spa`](https://github.com/likec4/likec4/tree/v1.59.4/packages/likec4-spa) | Использовать только как reference для provider composition и CSS layers. Пакет private, зависит от generated virtual modules и не подключается как dependency. |
| Multi-file server project | [`LikeC4.fromWorkspace()`](https://github.com/likec4/likec4/blob/v1.59.4/packages/likec4/src/LikeC4.ts) | В REQ-14 backend вызовет Node-only API после проверки configured workspace. Browser никогда не передаёт host path. |
| In-memory browser model | [`@likec4/language-services/browser`](https://github.com/likec4/likec4/blob/v1.59.4/packages/language-services/src/browser/index.ts) | `fromSources()` может использоваться только за изолированным adapter с pinned version. Это low-level API без incremental LSP editor flow. |
| Полный редактор | [`Playground Monaco config`](https://github.com/likec4/likec4/blob/v1.59.4/apps/playground/src/monaco/config.ts) и [`LanguageClientSync`](https://github.com/likec4/likec4/blob/v1.59.4/apps/playground/src/monaco/LanguageClientSync.tsx) | Перед REQ-19 выбрать проверенный вариант: pinned adaptation Playground либо backend `@likec4/lsp` c WebSocket-to-LSP bridge. LikeC4, а не приложение, предоставляет parser, diagnostics и language features. |
| Standalone LSP | [`@likec4/lsp`](https://github.com/likec4/likec4/tree/v1.59.4/packages/lsp) | Public Node-only LSP server; не browser/Monaco SDK и не содержит WebSocket bridge. Версия `1.59.4` имеет дефект пути к TypeScript declarations в npm tarball, поэтому её нельзя подключать без отдельной проверки. |
| Vite integration | [`likec4/vite-plugin`](https://github.com/likec4/likec4/tree/v1.59.4/packages/vite-plugin) | Не использовать как runtime dependency Web IDE: plugin рассчитан на Node/Vite host и generated virtual modules. |

Если фрагменты Playground будут адаптированы, в коде и в этой документации будут указаны исходный файл, upstream commit и MIT provenance.

## Границы REQ-01

REQ-01 создаёт только runnable app shell. `WorkspacePort` скрывает будущий filesystem provider, но пока `EmptyWorkspaceProvider` возвращает безопасные пустые данные. В этот срез не входят configured workspace, файловые операции, Monaco, parsing, diagnostics или diagram renderer.

Каждая панель запрашивает собственный HTTP resource и самостоятельно показывает loading, empty, ready или error state. Ошибка панели не должна заменять весь экран.
