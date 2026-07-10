# AGENTS.md

## Project overview

WriteLLM is an Electron desktop app for long-form academic/structured writing with LLM assistance, knowledge retrieval, and section versioning. It uses a SQLite database (better-sqlite3 + drizzle-orm) with a git-backed workspace for section history. The app has no web server — the renderer loads via Vite dev server in dev or from `dist/` in production.

## Architecture

```
src/
  main/          Electron main process (Node.js)
    main.ts        Entry point, creates BrowserWindow
    ipcHandlers.ts IPC bridge — all renderer→main calls go through here
    database.ts    SQLite wrapper (WriteLLMDatabase)
    db/schema.ts   Drizzle schema definitions
    llmRunner.ts   LLM streaming (Vercel AI SDK)
    knowledgeIndex.ts / knowledgeIngest.ts / retrievalWorker*.ts
                   Knowledge base: embedding, ingestion, retrieval
    gitSession.ts  Git-based section versioning
    exportLatex.ts Export workspace to Markdown/LaTeX
    sectionHistory.ts / sectionMarkdown.ts
    backgroundTasks.ts  plainjob-based background task queue
  preload/       contextBridge API (preload.cts → CJS)
  renderer/      React 19 frontend (Vite + Tailwind v4)
    main.tsx       React entry
    App.tsx        Main app shell
    components/    Shared UI (shadcn/ui based)
    features/      Feature modules: canvas, inspector, knowledge, llm, sections, settings, writing
    api.ts         Typed IPC bridge from renderer side
    styles.css     Tailwind v4 entry
  shared/         Types and IPC contract shared between main and renderer
    types.ts       All shared type definitions
    ipc.ts         Type-safe IPC channel map
    citations.ts   Citation parsing utilities
    sectionMarkdown.ts
```

- **IPC contract**: `src/shared/ipc.ts` defines the typed channels. `src/preload/preload.cts` exposes them via `contextBridge` as `window.writellm`. `src/renderer/api.ts` is the typed accessor. To add a new IPC method, add it in all three places.
- **Two TypeScript configs**: `tsconfig.json` (renderer+shared, uses `@/*` path alias → `src/renderer/*`) and `tsconfig.electron.json` (main+preload+shared, compiles to `dist-electron/`).
- **Path alias `@/`** maps to `src/renderer/` in both Vite and TS config.

## Commands

- `bun run dev` — Start Vite dev server only (no Electron, useful for renderer-only work)
- `bun run dev:electron` — Full Electron dev: compiles main/preload with `tsc`, starts Vite, then launches Electron with `VITE_DEV_SERVER_URL`
- `bun run build` — `tsc -p tsconfig.electron.json && vite build` (production build)
- `bun run start` — Build + launch Electron in production mode
- `bun run typecheck` — Checks both configs: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.electron.json`
- `bun run rebuild:native` — Rebuild better-sqlite3 native module for current Electron version

**No linter, formatter, or test runner is configured.** There are no `test`, `lint`, or `format` scripts. The only verification is `bun run typecheck`.

The closest thing to integration tests is `scripts/electron-smoke.mjs`, which runs against the compiled main-process code via `ELECTRON_RUN_AS_NODE=1`. It must be run after `bun run build` since it imports from `dist-electron/`.

## Key conventions

- **Package manager**: Bun (specified as `bun@1.3.4` in `package.json`)
- **Database**: SQLite via better-sqlite3 + drizzle-orm. Schema lives in `src/main/db/schema.ts`. Migrations via drizzle-kit (`drizzle.config.ts` points to `./project.sqlite`).
- **UI components**: shadcn/ui (radix-nova style) with Lucide icons. Components in `src/renderer/components/ui/`.
- **State management**: TanStack React Query (`@tanstack/react-query`).
- **LLM integration**: Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`).
- **Evidence coverage**: section-to-literature citation coverage is derived from Markdown citations and exposed through the workspace evidence view.
- **Task queue**: `plainjob` for background knowledge ingest jobs (`src/main/backgroundTasks.ts`).
- **Native module**: `better-sqlite3` requires `electron-rebuild` after Electron version changes (`bun run rebuild:native`).
- **Workspace format**: `.writellm` directories containing a git repo and SQLite database. The `.gitignore` excludes `*.writellm/` and `*.sqlite` files.

## Gotchas

- `src/preload/preload.cts` must use CJS (`require`/`module.exports`) because Electron's `contextBridge` requires it. It has its own extension `.cts` to signal this.
- The main process code uses `.js` extensions in imports (required by `NodeNext` module resolution in `tsconfig.electron.json`).
- `bun run dev` only starts the Vite dev server for the renderer. For full app testing, use `bun run dev:electron`.
- `bun run typecheck` must pass both TS configs. A type error in either main or renderer code will fail it.
- The `dist-electron/` directory is gitignored but required at runtime — it's built by `tsc -p tsconfig.electron.json` before Electron can start.
- `better-sqlite3` is a native module that must be rebuilt when the Electron version changes.
- `sqlite-vec` is used for vector similarity search in knowledge retrieval.
