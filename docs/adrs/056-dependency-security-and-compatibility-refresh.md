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
  the exact Checkpoint 64 targets. Existing exact pins remain exact; existing caret declarations
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
