# ADR 011: Security Boundary Remediation

Status: accepted and implemented in Checkpoint 26.8S
Date: 2026-07-31

## Context

A standard repository security scan of revision
`9c3119b5f29e1636671ce7b18ce4a13e2230ef3d` found eleven reachable issues: credential reuse after a
custom Agent endpoint change, five project-path and symbolic-link escapes, two MinerU SSRF paths,
one unbounded model-catalog response, and two oversized Main/IPC projections.

The existing architecture already requires Main-owned authority, project-relative records,
containment checks, encrypted credentials, bounded IPC, and ephemeral MinerU URLs. The defects are
missing common enforcement points rather than reasons to change those boundaries.

## Decision

Checkpoint 26.8S blocks Checkpoint 26.9 until all eleven findings pass adversarial regression
coverage.

- Main owns a `ProjectFilesystem` capability constructed from the canonical project root. It
  validates every existing path segment with `lstat`, rejects symbolic links and junctions,
  validates the deepest existing ancestor before creation, and owns no-follow deletion, exclusive
  staging, and atomic publication. SQLite adapters may receive only paths validated by this
  capability.
- An existing project database is opened read-only and its application role and project identity
  are checked before backup, migration, or any write. New databases are created only under a
  verified managed directory.
- Each encrypted credential has a SHA-256 binding to the provider-config ID, transport/API,
  authentication mode, and normalized endpoint origin. Binding is checked before decryption.
  Existing credentials for editable endpoints (legacy Agent, custom Agent, embedding, rerank, and
  MinerU) are invalidated once during migration because their historical origin cannot be proven;
  immutable built-in bindings may be backfilled.
- MinerU artifact URLs allow public HTTPS only. DNS results must all be globally routable; uploads
  do not redirect, while downloads follow at most three manually validated HTTPS hops. DNS
  rebinding remains a documented residual risk because this checkpoint does not pin the resolved
  address.
- HTTP bodies are streamed under an actual-byte limit. Knowledge detail is split into metadata,
  four-MiB block pages, and lazy four-MiB Markdown. Agent event pages are limited to fifty rows and
  four MiB.

The test harness may select an explicit loopback policy through a bootstrap-only E2E argument
that the application composition root converts into a background-worker constructor dependency.
No environment variable, persisted setting, project record, Renderer input, preload API, or IPC
request can enable that policy.

## Consequences

Existing credentials for editable endpoints require one-time re-entry after migration. Oversized
parsed Markdown remains available through paginated normalized blocks and the original-source
action but is not rendered as one IPC payload. No new worker role, generic RPC layer, network
service, or native filesystem dependency is introduced.

The filesystem control defends against malicious portable projects and pre-existing links, not an
active same-user process racing path replacement. A stronger race-free design requires a separate
cross-platform native handle/dirfd decision.
