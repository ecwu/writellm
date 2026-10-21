# ADR 090: Documentation Navigation And Dependency Boundaries

Status: accepted under Issue 18
Date: 2026-10-21

## Context

Issue 18 found high reading cost in the documentation tree. Current rules, past decisions, and
implementation evidence use different files, but readers cannot find the right file from one index.
The audit also found several provider and archive libraries. Their different process and data
boundaries make a count-only dependency cleanup unsafe.

The repository keeps an append-only implementation history. Moving old records or rewriting their
paths would break links and remove historical context. The current plan already owns delivery state,
so a second status report would create conflicting sources.

## Decision

Add `docs/README.md` as the documentation entry point and `docs/adrs/README.md` as the decision index.
The entry points route readers to these sources:

- `docs/current-plan.md` owns current delivery state and acceptance results.
- `docs/implementation-todo.md` owns the compact checkpoint tracker and Phase links.
- `docs/architecture.md` owns current system rules and boundaries.
- `docs/adrs/` owns design decisions and their supersession notes.
- `docs/implementation-todo/phase-*.md` owns detailed checkpoint plans and evidence.
- `docs/history/implementation-log.md` owns append-only implementation chronology.
- `docs/release-policy.md` owns distribution and publication rules.
- `docs/audits/` owns focused historical audit evidence.

The index records partial supersession explicitly. A later ADR replaces only the clauses that it
names. Unchanged clauses remain valid. A reader uses the later ADR for the current clause and the
earlier ADR for historical context.

The index also records dependency boundaries. The Agent runtime uses Pi adapters. Embedding and
reranking use their separate gateway interfaces. Image generation uses its fixed provider adapters.
Citation formatting and archive extraction use their own bounded libraries. A dependency count alone
does not justify removal or replacement. A proposed consolidation needs a new ADR with behavior
parity, security review, migration impact, and focused verification.

Compatibility-sensitive packages retain exact declarations where the architecture requires them.
Other packages can retain their approved range policy. The package manifest and lockfile remain the
authoritative dependency records. This ADR does not change package versions or introduce a migration.

Citation.js owns the transitive citeproc dependency.
A root pnpm override retains its reviewed version without an unused direct application dependency.
JSZip retains deterministic DOCX editing, Yauzl retains bounded extraction, and Yazl retains test archive creation.

## Consequences

Historical ADR and implementation-log paths remain stable. New work adds a link to the relevant
entry point and records evidence in the existing location. Readers can start with one index without
copying current status or past evidence into another document.

Dependency updates keep their existing process and security boundaries. Future consolidation work
must prove that one adapter can preserve the distinct lifecycle, capability, and error contracts
before a package or interface is removed.

## Supersession map

- ADR 084 replaces ADR 083 only for the macOS command surface. Windows and Linux retain the shadcn
  Menubar from ADR 083.
- ADR 060 replaces ADR 057 only for display Math and the application-owned Diagram boundary. ADR
  057 still defines native inline Math.
- ADR 062 replaces ADR 058's single-shot Notebook runtime. ADR 083 separately changes Notebook
  instance capacity and shared admission.
- ADR 074 replaces the recovery, trace-failure, and live-retry clauses named in ADRs 063, 069, 071,
  072, and 073. Their persistence and security clauses remain unless ADR 074 names them.
- ADR 076 replaces ADR 014's exclusion of manual and custom reasoning metadata. ADR 062 adds
  Notebook Thinking controls.
- ADR 067 replaces repeated tool-description policy from ADR 042. ADR 074 replaces its recovery
  limit, and ADR 077 removes its Review Issue surface.
- ADR 079 replaces ADR 078's quote-only comment mapping rule. Other comment ownership rules remain.
- ADR 089 defines the current shared manuscript section write boundary for the Issue 18 maintenance.

## Verification

Documentation checks use link consistency, a diff review, and formatting. They do not require an
application build or Electron tests. A dependency-boundary change uses the verification gate for its
affected process and package boundary.
