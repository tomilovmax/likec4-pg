# LikeC4 Web IDE

Self-hosted browser IDE для одного LikeC4 workspace. Реализованы REQ-01 (трёхпанельный app shell: Files, Code Editor, Diagram на одном URL), REQ-02 (настроенный и проверенный workspace), REQ-03 (изолированные файловые пути workspace), REQ-04 (навигация по разрешённым файлам workspace), REQ-05 (открытие исходного текста файла), REQ-06 (редактирование и изолированный buffer), REQ-14 (загрузка полного multi-file LikeC4 проекта), REQ-15 (интерактивный preview существующей LikeC4 view) и REQ-19 (подсветка LikeC4 и diagnostics официального browser language server).

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

Проверить дерево разрешённых файлов (только относительные пути; `.c4`/`.likec4` помечены как `likec4`, конфигурационные файлы LikeC4 — как `config`):

```bash
curl http://localhost:3000/api/files
# {"items":[{"path":"model","name":"model","kind":"directory"},{"path":"model/spec.c4","name":"spec.c4","kind":"file","language":"likec4"},{"path":"likec4.config.json","name":"likec4.config.json","kind":"file","language":"config"}]}
```

Открыть файл по относительному пути (ответ содержит буквальный UTF-8 текст и стабильный version token текущего содержимого; тот же token отдаётся заголовком `ETag`):

```bash
curl -D- http://localhost:3000/api/files/model/spec.c4
# etag: "f8d423…"
# {"path":"model/spec.c4","name":"spec.c4","language":"likec4","content":"model {}","version":"f8d423…"}
```

Загрузить полный multi-file LikeC4 проект как единую модель официальным API LikeC4 (`views` — все views проекта, `elements` — все элементы; при ошибках парсинга вместо модели приходит `status:"invalid"` со списком диагностик с workspace-относительными путями):

```bash
curl http://localhost:3000/api/project
# {"status":"ok","views":[{"id":"dev-extra","title":"Dev и Extra"},…],"elements":[{"id":"core","kind":"subsystem","title":"Core"},…]}
```

Получить layouted-модель для diagram preview (готовую к рендеру модель официального renderer'а, список views и default view; при ошибках парсинга — `status:"invalid"` с диагностиками, без модели; пустой workspace — `status:"empty"`):

```bash
curl http://localhost:3000/api/diagram
# {"status":"ready","model":{"_stage":"layouted",…},"views":[…],"defaultViewId":"index"}
```

## Текущее состояние

REQ-01 предоставляет трёхпанельный app shell и независимые loading/empty/error состояния панелей. REQ-02 добавляет server-side конфигурацию: сервер стартует только с существующим читаемым каталогом из `LIKEC4_WORKSPACE` и использует его как единственный filesystem root. REQ-03 добавляет единый path guard: все файловые операции принимают только относительные пути и физически не выходят за пределы workspace — `..`, абсолютные пути, URL-encoded traversal и symlink наружу отклоняются с 4xx, не раскрывая путей хоста. REQ-04 наполняет панель Files: `GET /api/files` возвращает вложенное дерево только из разрешённых LikeC4-файлов (`.c4`, `.likec4` и конфигурационные файлы LikeC4; скрытые записи, бинарные и нерелевантные файлы, а также ветки без LikeC4-файлов не попадают в дерево). REQ-05 открывает выбранный файл: `GET /api/files/<относительный путь>` отдаёт его буквальный UTF-8 текст и version token (sha256 содержимого, дублируется `ETag`) для будущего optimistic save; бинарные и запрещённые типы не выдаются как редактируемый текст (`UNSUPPORTED_FILE` 415), а Code Editor показывает текст без format-on-load. REQ-06 добавляет редактирование: Monaco-редактор держит изолированные буферы открытых файлов и отмечает несохранённые изменения. REQ-14 загружает полный multi-file проект: `GET /api/project` собирает весь workspace (config, specification, model, views, включая вложенные каталоги) в одну LikeC4 model официальным API `LikeC4.fromWorkspace()` пакета `likec4` 1.59.4 и отдаёт списки views и элементов; при ошибках парсинга — `status:"invalid"` с диагностиками без путей хоста. REQ-15 рендерит интерактивную диаграмму в панели Diagram (см. ниже).

### Diagram preview (REQ-15)

Панель Diagram показывает интерактивную LikeC4-диаграмму через официальный integration path — субпаф `likec4/react` пакета `likec4` **1.59.4** (опубликованный бандл `@likec4/diagram` того же релиза; отдельный пакет не устанавливается). Backend отдаёт `GET /api/diagram`: layouted-модель всего multi-file workspace (`layoutedModel().$data` — чистый JSON), отсортированный список views и `defaultViewId` (implicit `index`, иначе первая по алфавиту; выбор из списка — REQ-16). Frontend оживляет модель официальной фабрикой `LikeC4Model.create()` (`@likec4/core` 1.59.4) и рендерит `ReactLikeC4` в `LikeC4ModelProvider`: pan/zoom, клики по элементам, навигация между views по internal links — всё из официальных компонентов, самописного renderer'а нет.

Повреждённый DSL не отдаёт половинную модель: ответ `status:"invalid"` с диагностиками, панель показывает отдельное состояние и не выдаёт устаревшую диаграмму за актуальную. Ошибка самого renderer'а изолируется ErrorBoundary с кнопкой «Повторить» и не ломает Files и Code Editor. Модель и renderer грузятся без кэша и lazy-чанком (~2.3 МБ) соответственно; обновление preview после сохранения — предмет REQ-17.

### LikeC4 language integration (REQ-19)

Для REQ-19 выбран официальный browser worker `@likec4/language-server` **1.59.4** через `monaco-editor-wrapper` **6.7.0**, `monaco-languageclient` **9.6.0** и compatibility packages `@codingame/monaco-vscode-*` **16.1.1**. Это pinned adaptation LikeC4 Playground `v1.59.4`, commit `33dbc2d34c399a99daf96e92fc28fe5d280a7fd5`: `.c4` и `.likec4` подсвечиваются TextMate grammar, а diagnostics official language server появляются как Monaco markers и доступный список у активного файла.

При первом открытии LikeC4 source browser через существующий HTTP API загружает весь разрешённый DSL-набор в виртуальный `file:///` workspace (overlay filesystem + Monaco-модели, `apps/web/src/editor/likec4-language-runtime.ts`). URI существует только в памяти браузера и не раскрывает путь хоста. После загрузки набора клиент отправляет серверу кастомный запрос `BuildDocuments`. Несохранённые buffers имеют приоритет над первоначальным текстом API (существующие модели не перезаписываются) и write-through'ятся в memory filesystem; правки активного документа уходят серверу стандартным `textDocument/didChange`, а диагностика возвращается `publishDiagnostics` и наблюдается как Monaco markers (`onDidChangeMarkers`) плюс доступный список у активного файла. Invalid DSL либо недоступность другого source не закрывает editor. Конфигурационные JS/TS файлы не исполняются в browser, локальный LikeC4 CLI/extension и WebSocket bridge не требуются. Autocomplete, hover и другие language features предоставляются самим сервером; приложение не добавляет самодельные parser/grammar/completion provider.

Ограничения integration: диагностика Live-valid идёт по unsaved buffer, а не по диску (`GET /api/project` остаётся отдельной server-side проверкой сохранённого workspace); один browser language server на страницу (StrictMode в `main.tsx` отключён — двойное монтирование переинициализирует VS Code services, которые можно инициализировать только один раз); production bundle содержит chunk ~9 МБ с language server и Monaco. Для dev-режима Vite обязан prebundle'ить CJS-зависимости browser-сервера (`optimizeDeps.include` в `apps/web/vite.config.ts`, включая `p-queue`, `word-wrap`, `picomatch`, `strip-indent`, `indent-string`), иначе module worker умирает молча на `export named 'default'`.

`GET /api/project` остаётся отдельной server-side проверкой сохранённого workspace и не диагностирует unsaved editor text. Browser не сохраняет source на диск и не вызывает `toDSL()`, `writeDSL()` или `format()`.

MVP не включает Git, authentication, database, collaboration, history, AI, Kubernetes или CI/CD deployment.

## Проверка

```bash
npm run typecheck
npm run lint
npm test
```

Одиночный тест: `npx vitest run apps/server/src/config.test.ts`; конкретный сценарий: `npx vitest run -t 'rejects a missing directory'`.

## Upstream LikeC4

Архитектурные решения и перечень официальных компонентов LikeC4, которые переиспользуются, зафиксированы в [docs/architecture.md](docs/architecture.md). В частности, diagram preview использует публичные компоненты `@likec4/diagram` через субпаф `likec4/react`, а официальные Playground patterns задают ориентир для editor/LSP integration. Приложение не реализует собственные LikeC4 parser, renderer или syntax checker.
