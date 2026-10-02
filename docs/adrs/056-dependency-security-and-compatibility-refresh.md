# ADR 056: Dependency Security And Compatibility Refresh

Status: accepted for Checkpoint 64; implementation authorized
Date: 2026-08-23

## Context

The Checkpoint 63 lockfile reports nineteen production advisories: seven high, eleven moderate,
and one low. The exposed application paths include project PDF parsing/rendering through
`pdfjs-dist`, project-authored Mermaid rendering, Kysely-backed authoritative databases, and
transitive packages beneath BlockNote and Electron. The repository also has compatible maintenance
drift across provider, Renderer, data, formatting, and test dependencies.

Taking every registry `latest` version together would cross unrelated boundaries. Vite 8 is
outside electron-vite 5's peer range and replaces the bundler core; TypeScript 7 rejects the
current `baseUrl` configuration and has a new compiler implementation; Vitest 4 changes test and
mock behavior; better-sqlite3 13 changes the native integration to N-API; and Pi 0.81-0.84 changes
harness APIs that are intentionally pinned behind WriteLLM's Agent runtime boundary.

## Decision

Checkpoint 64 is a bounded security and compatibility refresh:

- Remain on Electron major 43 and update the baseline to 43.4.1.
- Update `pdfjs-dist` to 6.2.108, Mermaid to 11.17.0, Kysely to the fixed 0.28.17 line, and the
  three BlockNote packages together to 0.54.0.
- Keep WriteLLM's explicit BlockNote schema. The new native Math/Diagram specs, Yjs, collaboration,
  and BlockNote-owned persistence are not admitted. The application-owned math, Mermaid, figure,
  revision, canonicalization, and hash contracts remain authoritative.
- Update selected same-generation provider, Renderer, data, formatting, and test dependencies to
  the exact Checkpoint 64 targets. Existing exact pins remain exact. Existing caret declarations
  retain caret semantics with a refreshed lockfile.
- Refresh vulnerable transitive versions only within parent-declared compatible ranges. Do not use
  an override to force a package across its parent's admitted major line.
- Align Node type declarations with Node 24, which is both the project engine line and Electron
  43's embedded Node line.

The Renderer remains sandboxed and receives no new filesystem, database, network, credential, or
IPC authority. No project/app database migration, persisted content version, worker role, Agent
tool, provider capability, durable job, or release behavior is added.

## Deferred migrations

Vite 8 plus @vitejs/plugin-react 6, Vitest 4, TypeScript 7, better-sqlite3 13, Pi 0.84, Kysely
0.29, KaTeX 0.18, @shadcn/react 0.3, and thinking-orbs 0.3 remain separate decisions. They must
not be pulled into Checkpoint 64 through a broad update command or transitive override.

## Verification consequences

BlockNote must pass persisted v1-v3 and custom-block characterization, including stable IDs and a
no-op round trip that preserves canonical content and hashes. PDF and Mermaid retain adversarial
and legitimate controls. Database migration/backup, provider/Agent contracts, project history,
custom protocols, PDF worker loading, and Renderer CSP remain covered.

Because Electron and packaged resources change, Checkpoint 64 requires the canonical Electron
suite, production build, complete Real-Electron suite, recovery fixtures, no-identity package
gate, production and complete dependency audits, frozen installation, and diff checks. Signed
release verification, hosted CI, candidate creation, commit, push, promotion, and publication are
outside this decision.

## 2026-10-02 maintenance amendment

The user authorized security fixes and routine maintenance after the dependency review.
This maintenance keeps Electron 43, Pi 1.0, BlockNote 0.54, and the existing database and content formats.
It updates compatible provider, Renderer, data, formatting, and test dependencies.
Exact declarations remain exact, and caret declarations retain their range policy.

Electron 43.7.7 fixes the preload cache advisory.
Version overrides admit repaired fast-uri, brace-expansion, undici, js-yaml, DOMPurify, and tar releases within their existing major lines.
Tiptap overrides remain on 3.x and advance together to 3.31.4.

ProseMirror View resolves to one compatible 1.42.6 version across the editor dependency tree.
ProseMirror Model also resolves to one compatible 1.25.12 version to preserve runtime class identity.
The existing browserslist override advances within 4.x to 4.29.3.
The existing BlockNote patch remains required.

Vitest 4.1.11 replaces the deferred Vitest 4 decision only for this security refresh.
Vitest 3 has no planned fix for GHSA-82fw-gwwq-j7x9.
Vitest 5 adds unrelated behavior changes, so this maintenance selects the repaired 4.x line.

The existing Electron runner remains authoritative.
Its reporting fixture must retain retry, skip, duration, and result counts.
The migration guide removes the public `onTaskUpdate` contract.
The exact 4.1.11 source still dispatches that event.
The retry fixture must establish actual compatibility before acceptance.
The final diagnostic determines retry counts, including exhausted retries.

The fixture limits discovery to its own file.

Playwright advances to 1.63.0 with its Linux credential-store patch preserved and reviewed against the new loader.
Node 24.21.0 and pnpm 11.28.3 replace their earlier maintenance pins across bootstrap scripts and CI.
Node declarations stay on 24.x.
The host toolchain remains in place.

DOCX normalization assigns bookmark identifiers in document order and preserves each start and end pair.
This removes the new process-wide bookmark counter from export bytes and preserves the accepted deterministic output contract.

This maintenance adds no provider capability, database migration, content schema, or new process authority.
BlockNote 0.55, Citation.js 0.9, Kysely 0.29, KaTeX 0.19, Mermaid 12, and better-sqlite3 13 remain separate migrations.
Vite 8, plugin-react 6, TypeScript 7, and Vitest 5 also remain separate.
The pnpm 12 and CI Action major updates remain separate.

Acceptance requires a frozen installation, production and complete dependency audits, the complete Electron-hosted suite, and the full package gate.
The package gate covers recovery fixtures, native modules, resources, runtime smoke, and all packaged Electron scenarios with one App build.
Additional source-only scenarios can reuse that build when the same compiled inputs apply.
Current evidence belongs in the current plan and implementation history, rather than the completed Checkpoint 64 record.

## 2026-10-02 Issue 2 first-stage amendment

The user authorized the first stage of [Issue 2](https://github.com/ecwu/writellm/issues/2).
This stage updates Citation.js core, plugin-bibtex, and plugin-csl together to 0.9.0.
It updates thinking-orbs to 0.3.2 and better-sqlite3 type declarations to 9.6.0.
Exact declarations remain exact, and the type declaration retains its caret range.

Citation.js requires Node 22.12 or later, which the accepted Node 24 line satisfies.
Its plugins require core 0.9.x, and its fetch adapter changes to sync-fetch-undici.
The application continues to parse supplied bibliography content through its existing adapters.
The Main build replaces Citation.js fetch utilities with the existing network-denied module.
This blocks both sync-fetch-undici and the new global-fetch path under ADR 034.
The Main bundle includes the CSL plugin so that it shares the Core plugin registry.
No remote bibliography lookup or new network authority is added.
ThinkingOrb retains the existing state, size, theme, and canvas attributes.
Its optional pointer interaction remains disabled.
The better-sqlite3 native library remains at 12.11.1.

Acceptance requires frozen installation, both dependency audits, static analysis, and the Electron-hosted suite.
Selected real Electron scenarios cover bibliography import, citation export, Agent state animation, themes, and reduced motion.
The fetch utility replacement changes the Main bundle configuration.
Final acceptance also requires the full package gate to cover this dependency boundary in the packaged App.
All later Issue 2 stages remain deferred.

## 2026-10-02 Issue 2 second-stage amendment

The user approved the second-stage migration after the compatibility review.
This stage accepts Kysely 0.29.6, all four BlockNote packages at 0.55.0, and Vitest 5.0.3.
Exact declarations remain exact, and Vitest retains its caret range.
Kysely now publishes ESM only.
The accepted Electron Node 24 runtime supports its module loading requirements.
The application uses its own database migration runner and no removed Kysely interfaces.
Database formats and migration versions remain unchanged.

The BlockNote React popup patch moves to the 0.55.0 source and distribution files.
Tiptap remains unified at 3.31.4, and ProseMirror packages retain one compatible runtime version each.
ProseMirror Transform advances to at least 1.12.1.
Native inline-math input rules retain explicit extension registration.
Canonical document formats, stable block IDs, and export contracts remain authoritative.
Comment creation releases the Renderer mutation barrier after its IPC request settles.
The real Electron scenario must prove that editing resumes and the new text reaches a saved revision.

Vitest retains the canonical Electron runner and the custom verification report.
Its default mock-history clearing applies to the migrated suite.
The retry fixture must exercise real failures because expected-failure tests now stop after the first expected failure.
The reporter must establish retry, skip, failure, duration, and result counts against the exact installed version.

Acceptance requires frozen installation, both dependency audits, the complete Electron suite, and the full package gate.
The package gate uses one App build for runtime smoke, packaged scenarios, and installers.
Other Issue 2 migrations remain deferred.

## 2026-10-02 Issue 2 independent migrations amendment

The user authorized all four independent migrations in Issue 2.
Each migration retains its own implementation and acceptance evidence.
TypeScript advances to 7.0.2, Mermaid to 12.1.0, better-sqlite3 to 13.0.3, and Electron to 44.5.1.
Existing exact and caret declaration policies remain in place.

TypeScript removes baseUrl and uses explicit relative path mappings.
The compiler entry point and Main/Renderer defaults require verification.
Mermaid explicitly uses Dagre layout and classic appearance for existing documents.
Strict configuration, theme selection, SVG cleanup, image isolation, and source exports remain authoritative.

better-sqlite3 uses Node-API, the stable native extension interface.
Native preparation resolves the binary selected by the package loader, including bundled prebuilds and source-build fallback.
Package inventory verifies that exact binary and its target architecture.
Database migrations, backup, integrity checks, and sqlite-vec remain required.

Electron 44 raises the supported macOS minimum to 13 for both architectures.
Remaining on Electron 43 would retain macOS 12 support but defer the authorized migration.
Package metadata and user guidance must state the new minimum.
Linux packaging must account for statically linked ANGLE and retain the configured GTK dependencies.
The application does not replace ANGLE libraries.
Renderer sandboxing, session authorization, IPC, credentials, and worker roles remain unchanged.

Acceptance includes frozen installation, both audits, static checks, the complete Electron suite, and the full package gate.
Independent evidence can reuse a matching final build across unchanged boundaries.
This host verifies macOS arm64 only. Other platform acceptance remains pending.
No release metadata change, hosted workflow, tag, push, or publication is part of these migrations.
