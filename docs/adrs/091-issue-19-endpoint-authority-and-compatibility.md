# ADR 091: Single IPC Endpoint Authority And Compatibility Repairs

Status: accepted under the user's Issue 19 implementation request
Date: 2026-10-21

## Context

[Issue 19](https://github.com/ecwu/writellm/issues/19) audits the Issue 18 delivery in commit
`7da0fc8`. That delivery added typed endpoint definitions under
[ADR 088](088-typed-ipc-endpoints.md), but each domain module found the endpoint by channel and
wrapped its unchanged handler. Main therefore parsed input and output and checked the project
session twice per request. Each module also fell back to plain `ipc.handle` without sender
authorization when a channel had no endpoint. The registration helper chose rejection behavior by
inspecting `handler.constructor.name`, and session rejections moved ahead of domain lifecycle
logging.

The same delivery unified canonical JSON under [ADR 086](086-issue-18-engineering-quality.md).
The shared serializer rejected inputs that the model-request fingerprint, trace, and manuscript
export serializers had accepted. The error-handling guard detected only zero-argument and empty
catches, and its tokenizer did not rescan template continuations.

## Decision

### IPC endpoints

`registerIpcEndpoint` is the only place a migrated endpoint authorizes the sender, parses input,
checks its declared session, and parses output. Every invocation is asynchronous, so all failures
surface as rejections.

The session check returns the `ProjectContext`, and the handler receives it as an argument.
Handlers do not reparse input, reassert the declared session, or reparse output. A handler still
revalidates the session after an `await` when later work depends on the project remaining open.

`createEndpointRegistrar` binds one domain's options and accepts only endpoint definitions.
A domain cannot register a channel without a declared contract, so the unauthorized fallback no
longer exists. Event replay and live subscriptions remain explicit adapters that authorize their
sender.

An optional `around` wrapper runs session authorization, the handler, and output validation.
Domains use it for lifecycle logging and safe error boundaries, so a session rejection reports the
same operation event as any other failure.

Project-scoped endpoints declare `session: 'none'` only when another path owns authorization.
Examples include a closing-token flush, a typed session-revoked result, a lease release after
revocation, or a `ProjectManager` method that checks the session inside its failure boundary.
A test allowlist names each such endpoint and its reason.

`withIpcLogging` already establishes the IPC log context. Project IPC no longer nests a second
context with a new `requestId`.

### Canonical JSON compatibility

The shared serializer remains strict by default. Explicit options reproduce historical rules:

- undefined array members and holes as `null`
- non-finite numbers as `null`
- enumeration of non-plain objects
- skipped symbol keys

`LEGACY_MODEL_REQUEST_FINGERPRINT` and `LEGACY_TRACE_DOCUMENT` select the rules each historical
serializer applied. Manuscript export keeps its non-plain enumeration and symbol skipping.

### Error-handling guard

Without an `error-handling: allow owner=<owner> reason=<reason>` marker, the guard rejects:

- empty catches
- catches without an error binding
- zero-argument Promise catches
- catch clauses or Promise catch callbacks whose error binding is never referenced

A property access with the same name is not a reference.

`scripts/lib/ts-source.mjs` owns the shared TypeScript tokenizer for the guard and the schema
contract test. It rescans template continuations and regex literals. TypeScript is pinned exactly
because the scanner comes from `typescript/unstable/ast`.

### Persistence helpers

`cachedStatement` reuses one prepared statement per connection, SQL text, and result mode.
`SectionRepository` and the repeated statements in Main-process loops use it.

Shipped migrations import the frozen helpers in `migrations/helpers.ts`. A pinned behavior test
guards those helpers. New behavior requires a new helper.

## Alternatives

- **Keep the wrapper and remove only the fallback:** rejected. Main would still validate and
  authorize each request twice.
- **Infer session authority from channel names:** rejected. [ADR 088](088-typed-ipc-endpoints.md)
  already rejects this.
- **Rewrite stored fingerprints to the strict format:** rejected. This would change persisted
  identity without a migration.
- **Replace the token scanner with a full parser:** deferred. TypeScript 7 exposes no stable
  JavaScript parser API, and adding one would introduce a new dependency.

## Migration impact

No database migration, channel rename, Renderer capability expansion, or stored-data change.
Existing fingerprints, traces, and exports retain their serialized form.

## Verification

- Endpoint tests cover asynchronous results, the handler context, `around` session rejection, and
  output rejection.
- An allowlist test covers each project-scoped endpoint declared `session: 'none'`.
- Domain IPC tests remain the acceptance boundary for authorization, revocation, and logging.
- Canonical JSON tests compare each legacy profile with outputs from the historical serializers.
