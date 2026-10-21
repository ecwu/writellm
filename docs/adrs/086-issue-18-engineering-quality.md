# ADR 086: Engineering Quality Boundaries

Status: accepted
Date: 2026-10-21

## Context

[Issue 18](https://github.com/ecwu/writellm/issues/18) identifies repeated code, missing error reports, and unclear implementation ownership.
The user authorizes maintenance that resolves these findings and preserves application behavior.
The working tree also contains earlier dependency and DOCX maintenance.
Those changes remain part of the local acceptance baseline.

## Decision

Shared helpers own repeated behavior when their callers require the same guarantees.
Hashing, cancellation, canonical JSON, durable file writes, and backup publication retain their existing compatibility boundaries.
Canonical JSON changes cannot rewrite historical fingerprints or persisted records.
Opaque cursors retain their domain identity, snapshot rules, and authorization checks.

Renderer failures use the shared error reporter before local recovery when Renderer owns the original failure.
Main retains logging ownership for failures that it already reports before an IPC rejection.
IPC means messages between application processes.
Subscription cleanup rejects late session events and releases subscriptions that finish after disposal.
Automated source inspection rejects unmarked error suppression.
Explicit exceptions explain the existing logging owner or recovery behavior.

Endpoint definitions contain channel names, schemas, and session requirements.
Main retains sender authorization and authoritative capability checks.
Preload retains bounded input and output parsing.
The renderer receives only named business methods.
This maintenance adds no general RPC interface, dependency, worker role, or renderer privilege.

Section writes share transaction-compatible primitives.
Services retain their approval, revision, comment, asset, and lifecycle responsibilities.
Forward migrations retain their identifiers, checksums, SQL, and recovery behavior.
Schema inspection compares migrated databases with the declared TypeScript tables.

Service decomposition follows lifecycle and operation ownership.
Moving a large function without reducing coupled responsibilities does not satisfy this decision.
Existing lifecycle tests remain the acceptance criteria for extracted services.
E2E helpers share identical project and provider fixture behavior.
E2E means tests that operate the real application.
The static gate includes E2E typechecking before the application build.
Missing fixture imports must fail before interaction tests start.

## Alternatives and migration impact

A new RPC framework adds an unnecessary trust boundary.
A wholesale ORM migration adds data risk without resolving the observed documentation mismatch.
ORM means an object interface for database records.
Removing specialized provider SDKs requires demonstrated feature parity within the accepted adapters.
This maintenance does not change supported provider capabilities to reduce the dependency count.

No application or project migration is required.
Generated test failures leave version control, and identical provider assets share one stored file.
Existing project files, revision identities, IPC method names, and historical document links remain compatible.
The current plan records delivery state and links the completed evidence.

## Verification

The changed boundaries span IPC, persistence, utility processes, and application lifecycle.
Acceptance uses the Electron test runner and packaged runtime scenarios.
One package gate supplies the matching build for packaged interaction tests.
Source-only scenarios reuse matching output.
Local evidence identifies counts, duration, retries, failures, and platform limits.
