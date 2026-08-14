# ADR 045: Isolated Cordis Agent Replacement

Status: proposed; user-approved direction, target architecture pending explicit acceptance  
Date: 2026-08-14  
Revised: 2026-08-14 — incorporated the design-review round: per-process composition trust
boundaries, deferred request-trace scope, parity additions, the dsh-package reuse alternative,
and the plan-mode/subagent/goal/user-questions scope decisions

## Context

The current WriteLLM Agent is built around `@earendil-works/pi-agent-core` and
`@earendil-works/pi-ai`. Its Main session service, Agent utility process, worker protocol, prompt
builder, tool registry, compaction, queue, durable events, IPC contracts, and Renderer panel form
one Pi-specific runtime.

The Cordis source study found that Cordis supplies a lifecycle-aware dependency injection and
composition runtime, while DeepSeek Harness builds Agent behavior as independent service seams,
providers, policies, tools, durable session protocols, and UI plugins. DeepSeek Harness also relies
on a hardened published Cordis line rather than behavior identical to the current upstream RC.

The user wants a complete Cordis reimplementation and ultimately wants Pi removed. During the
transition, the user wants both Agent approaches available for selection but does not want their
implementations to overlap.

Replacing the engine is not the primary product outcome. The new architecture must create a better
Agent experience and a stable extension model: structured prompt/context injection, trusted live
reload with last-good recovery, plugin/dependency inspection, exact request trajectory, and a local
cross-process request trace suitable for debugging.

WriteLLM also has product records that currently point directly to Pi Agent sessions, runs, events,
and proposals. Manuscript mutation, Review Issues, Writing Tasks, assets, credentials, and project
data cannot be duplicated safely merely to keep the runtimes separate; they are application
authority, not Harness behavior.

## Decision

WriteLLM will implement a greenfield Cordis Agent as a second isolated engine.

### Engine isolation

- The engine IDs are `pi-legacy` and `cordis`.
- Each engine owns a separate utility-process implementation, session/event schema, worker
  protocol, loop, LLM runtime, prompt assembly, tool registry, compaction, queue, IPC namespace,
  Renderer panel, and live state.
- A session is permanently bound to the engine that created it.
- There is no event conversion, session migration, shared transcript model, dual write, or runtime
  fallback between engines.
- The application shell may select an engine, set the default for new sessions, and route an opaque
  tagged session handle to the owning Renderer feature.
- Cordis code may not import either Pi package or any legacy Harness runtime module.

### Shared product authority

Both engines may call engine-neutral Main services for manuscript, knowledge, Writing Skills,
deterministic checks, proposals, approvals, Review Issues, Writing Tasks, assets, provider catalog,
credentials, model audit, and observability.

Product records that currently use Pi-only foreign keys will be generalized with a closed engine
origin. This is a one-time product-authority migration, not a Harness compatibility layer. Pi and
Cordis session/event stores remain separate and are never converted.

### Cordis runtime

- The initial framework dependency is exact `@deepseek-ai/cordis@4.0.1`.
- WriteLLM also pins the matching DeepSeek Loader, Include, Group, and HMR packages and freezes their
  candidate/commit/rollback behavior in a conformance suite.
- Production composition resolves stable IDs through a trusted built-in catalog; configuration
  cannot name arbitrary modules or packages.
- Prompt/instruction/skill content and trusted built-in configuration can reload transactionally.
  In-flight requests retain their frozen composition generation; failed candidates leave the
  last-good generation active.
- Development code HMR is separate from production config/content reload. Arbitrary packages,
  marketplace plugins, and model-authored code remain outside this decision.
- Main, the Cordis utility process, and the Cordis Renderer feature each own an appropriately
  constrained Cordis context tree.
- Durable project facts live in Main-owned SQLite; live Cordis events are not recovery state.
- The Cordis utility process has no database, project path, filesystem, or credential authority and
  reaches product capabilities only through a Zod-validated capability-bound Main bridge.
- The new LLM seam and provider adapters contain no Pi types or runtime dependency.
- Prompt, durable runtime context, variables, tool schemas, policy, presentation, projection,
  diagnostics, and telemetry use separate typed contribution surfaces.
- Composition is per process. The Renderer runs only the Cordis core runtime (no Loader, Include,
  Group, or HMR); its UI composition is fixed at build time and runtime control is limited to
  enable/disable projection. Production configuration never evaluates `!!js` expression nodes.
- Exact request headers remain durable authority; a read-only trajectory projects them for users.
  Protocol envelopes carry correlation and trace identifiers from the start, but the span model,
  local sink, and trace inspector UI of a metadata-only local request trace are deferred to a
  separately authorized decision; the trace is never recovery state either way. External telemetry
  is disabled by default and requires consent plus fail-closed redaction.

### Final removal

After Cordis reaches complete product, provider, recovery, UI, and packaged parity and becomes the
accepted default, a separately authorized stage removes the Pi dependencies, worker, runtime,
protocol, IPC, Renderer feature, and legacy session data surface.

Pi sessions are not converted. Before destructive legacy-table removal, WriteLLM creates and
verifies a project backup and may provide a static transcript export. After Pi deletion, rollback
requires restoring the complete prior application and project backup; no compatibility adapter is
retained.

### Scope decisions from the 2026-08-14 review

- Plan mode is excluded. Directional refinement of a writing request is served by structured
  clarification questions and ordinary conversation, not by a separate planning mode.
- Subagents are excluded. The agent registry/loop split is kept for loop replaceability and test
  doubles, not for multi-agent orchestration. No subagent drivers, nested agent event trees, or
  cross-agent control tools may be introduced without a new ADR.
- A goal capability (a durable objective with a verifier, bounded rounds, and a turn-stopping
  driver; for example "rewrite wording across the manuscript to remove AI phrasing habits") is
  accepted as a deferred, separately authorized post-parity stage. The architecture reserves the
  seam; the parity program R1-R9 does not implement it.
- Structured user questions (agent-initiated clarifying questions with options) are accepted as a
  deferred, separately authorized post-parity stage. They share the interactive pause/resume
  machinery with approval but use their own event family and carry no policy-tightening semantics.

The detailed architecture and gates are defined in:

- [`cordis-reform/target-architecture.md`](../cordis-reform/target-architecture.md)
- [`cordis-reform/implementation-plan.md`](../cordis-reform/implementation-plan.md)

## Alternatives considered

### Wrap the existing Pi runtime in Cordis plugins

Rejected. This preserves Pi's loop, protocol, state, and failure model while adding a second
lifecycle layer. It cannot reach the target of deleting Pi and makes Cordis mostly decorative.

### Build one common Agent runtime interface and adapt both engines

Rejected. A common transcript/run/tool abstraction would force one engine's semantics onto the
other, create ongoing conversion code, and turn the transition into permanent compatibility
maintenance. The only shared router is the application shell over opaque engine-tagged handles.

### Replace Pi in place without a dual-engine period

Rejected for delivery. It gives no working fallback while provider, tool, proposal, recovery, and
packaged parity are still being proved. The dual-engine period isolates risk without authorizing a
compatibility format.

### Duplicate all product services for Cordis

Rejected. Two manuscript mutation authorities, proposal stores, Review Issue systems, or asset
lifecycles could disagree and corrupt product state. Product authority is shared below the Harness
boundary and carries an explicit engine origin.

### Import DeepSeek Harness wholesale

Rejected. Its coding-agent capabilities, host/web surfaces, dynamic Cordis extensions, and package
topology do not match WriteLLM's desktop writing product or trust boundaries. WriteLLM adopts the
Cordis runtime and selected architectural patterns, then implements its own services and plugins.

### Selectively reuse published DeepSeek Harness core packages

Rejected. Packages such as `@deepseek-ai/dsh-agent`, `dsh-agent-loop`, `dsh-session`, and
`dsh-system-prompt` are published on npm, but they encode coding-agent semantics, carry their own
dependency graphs (including a Pi AI provider and JSONL-oriented persistence), evolve at
release-candidate pace, and know nothing of WriteLLM's Electron process, capability, and approval
boundaries. Reusing them would import Harness product decisions along with the code. WriteLLM
reimplements its own session, loop, prompt, and tool seams on the shared Cordis substrate; only
the framework packages are adopted.

### Use upstream `cordis@4.0.0-rc.8`

Rejected for the initial baseline. The source study found lifecycle and transactional hardening in
the DeepSeek line that its Harness relies on. The exact DeepSeek-published package is paired with a
WriteLLM conformance suite and may be revisited through a separate upgrade decision.

### Keep a static plugin bundle and defer reload/trace

Rejected. It would replace the loop implementation but defer the user-facing qualities that justify
the reform. Trusted transactional reload, contributor attribution, plugin diagnostics, and request
trace are substrate requirements and must be designed before product plugins accumulate.

## Consequences

- The transition temporarily carries two complete Agent implementations and two Renderer features.
- Some current Main Agent code must be split into engine-neutral product authority and legacy Pi
  adapters before Cordis write parity can be reached.
- Cordis feature work cannot reuse Pi session, event, prompt, loop, LLM, or tool-runtime code even
  when copying it would be faster.
- Existing Pi sessions remain usable only while the legacy engine is present and are archival after
  final deletion unless statically exported.
- The engine selector is temporary and is removed with Pi.
- Provider parity is a substantial independent workstream because the Cordis engine may not use
  `pi-ai` as an adapter.
- Cordis framework upgrades become explicit audited maintenance.
- The trusted composition catalog, content/config reload, plugin inventory, trajectory, trace, and
  privacy/retention controls become first-class product surfaces with their own conformance gates.
- Main security, IPC validation, project capability, database, credential, and recovery invariants
  remain mandatory and are not delegated to Cordis.
- The Cordis Host Protocol v1 becomes the axis of the new engine: every durable event append,
  authoritative tool execution, approval round-trip, and request snapshot crosses it. Its design
  and property tests are a first-class workstream, not a side effect of process plumbing.
- Stage R4 (engine-neutral product authority) has the largest blast radius of the transition
  because it migrates live product tables while Pi is still the production engine; it carries no
  Cordis dependency and may be scheduled independently, including before R1.

## Acceptance requested

Acceptance of this ADR authorizes the architecture direction and permits a separately scoped R1
checkpoint proposal covering the Cordis/composition substrate, conformance, read-only inventory, and
trace contracts. It does not by itself authorize dependencies, migrations, implementation, package
builds, commits, pushes, releases, arbitrary external plugins, or deletion of Pi data.
