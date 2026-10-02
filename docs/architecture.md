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

REQ-01 создаёт только runnable app shell. `WorkspacePort` скрывает filesystem provider за интерфейсом. В этот срез не входят configured workspace, файловые операции, Monaco, parsing, diagnostics или diagram renderer.

Каждая панель запрашивает собственный HTTP resource и самостоятельно показывает loading, empty, ready или error state. Ошибка панели не должна заменять весь экран.

## Границы REQ-02

REQ-02 делает workspace server-configured. `loadServerConfig` (`apps/server/src/config.ts`) читает `LIKEC4_WORKSPACE` и `PORT` до построения приложения и проверяет каталог: существует, является directory и читаем процессом. При пустом, отсутствующем или недоступном значении startup завершается однострочной понятной ошибкой; сообщения называют только значение оператора, а не resolved-пути хоста. `PORT` по умолчанию — безопасное непривилегированное `3000`.

`LocalWorkspaceProvider` (`apps/server/src/adapters/local-workspace.ts`) — единственная реализация `WorkspacePort`; placeholder REQ-01 `EmptyWorkspaceProvider` и статус `unconfigured` удалены, так как сервер без валидного workspace больше не стартует. `GET /api/workspace` возвращает только `status` и `displayName` (basename нормализованного configured-пути; symlink-цель и абсолютный путь хоста не раскрываются). HTTP API не имеет параметров выбора workspace path.

`listFiles` и `getDiagram` остаются placeholder'ами до REQ-04 и REQ-15. Новые upstream-зависимости не добавлены: используется только `node:fs`.

## Границы REQ-03

REQ-03 вводит единственный path guard файловых операций — `WorkspacePathResolver` (`apps/server/src/workspace-paths.ts`). `LocalWorkspaceProvider` владеет им как единственной точкой резолюции; файловые операции REQ-04–REQ-11 (list, read, write, create file, mkdir, rename, delete) принимают от клиента только относительный путь и резолвируют его исключительно через этот resolver. Два режима: `resolveExisting` (read, delete, источник rename) проверяет realpath самой записи; `resolveChild` (write, create, mkdir, назначение rename) — realpath parent, а если запись уже существует, то и её realpath. List строится обходом от доверенного корня без клиентского пути.

Проверка двух уровней. Лексическая: путь проверяется после URL-decoding и после нормализации — `..`, абсолютные пути (posix и windows-формы) отклоняются до любого обращения к fs, NUL и `\` считаются запрещёнными символами. Физическая: realpath проверяемой цели обязан находиться внутри realpath workspace root, поэтому symlink наружу не проходит; внутренние symlink разрешены, клиенту отдаётся реальный относительный путь. Повторное декодирование сознательно не выполняется: значение, пришедшее дважды закодированным, остаётся литеральным именем и заканчивается 404, не становясь traversal.

Коды ошибок (`packages/contracts`): `INVALID_PATH` 400 (malformed-путь), `PATH_OUTSIDE_WORKSPACE` 403 (traversal, абсолютный путь, symlink наружу), `NOT_FOUND` 404 (несуществующая запись или parent) — все варианты дают 4xx через общий error envelope. Сообщения называют только путь, присланный клиентом; абсолютные пути хоста, realpath-цели и содержимое внешних файлов не раскрываются. Runtime-код не выполняет shell-команд и не использует `child_process` (единственный вызов — startup-тест REQ-02, который запускает сам сервер фикс-командой без пользовательских данных), поэтому пользовательский DSL и пути в shell не попадают.

Известное ограничение: проверка realpath и последующая файловая операция — не одна атомарная транзакция (существует TOCTOU-окно). MVP работает в доверенной single-user среде, поэтому это принято сознательно. Новые upstream-зависимости не добавлены.
