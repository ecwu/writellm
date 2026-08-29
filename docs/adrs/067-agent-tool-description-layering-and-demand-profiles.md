# ADR 067: Agent Tool Description Layering And Demand Profiles

Status: accepted for Checkpoint 75; amended for model-visible union compatibility
Date: 2026-08-28

## Context

WriteLLM sent all 21 writing tools on every writing-model call. Their descriptions repeated shared
authority, exact-ID, empty-result, conflict, pagination, and retry rules already present in the
application policy and structured tool errors. The serialized envelope consumed roughly eleven
thousand estimated tokens before conversation content. Local OpenAI-compatible testing also found
that `read_section` and `generate_image` exposed a union at the parameter root, while LM Studio
requires every function parameter root to be an object with a `properties` object.

Pi, Codex, and OpenCode use short capability descriptions, keep shared behavior in harness policy,
and expose only tools relevant to the current role or task. The installed Pi runtime can replace
the active `context.tools` between model calls, so WriteLLM can adopt the same pattern without a
new provider branch, model call, UI mode, or authority boundary.

## Decision

Agent Harness Protocol v12 keeps `writing` and `notebook_knowledge` as the outer Main-authorized
profiles. A writing run starts with context/manuscript/evidence reads, Writing Skill loading,
`ask_user`, and the sequential `activate_tool_groups` tool. The activation tool enables one to
three distinct `review`, `writing_task`, `brief`, `writing_rules`, `outline`, `section`, or `image`
groups for later calls. Groups accumulate only for the current run and reset on the next run.
Notebook keeps only `search_knowledge` and `read_citations` and cannot activate writing tools.

Activation is application state, not new project or mutation authority. It must be the only tool
call in its assistant message. Worker exposes only the active set, while Main separately rejects a
tool outside that set. Main preflights the resulting fixed context before committing activation;
an unsafe model capacity leaves the set unchanged and returns a structured error. Initial calls,
tool continuations, compaction planning, and provider-overflow restarts account for the exact
active envelope. Main sends the active groups and resulting runtime message budget on every
writing run start and continuation authorization; Worker atomically replaces Pi tools and budget.

Shared tool behavior lives once in the application policy. A tool description contains only its
purpose, use trigger, and at most one unique boundary in one or two short sentences, capped at 240
characters. Parameter descriptions explain only local field meaning and relationships. Empty,
pagination, stale, conflict, and retry guidance comes from structured results. The complete
22-tool envelope remains capped at 48 KiB with no tool above 8 KiB, while the initial writing
envelope has a separate 20 KiB ceiling.

Model schema normalization always presents a root `{ type: "object", properties: ... }`. For a
root object union, normalization projects every branch property into that root, merges literal
discriminators into enums, and requires only fields common to every branch. The original union is
retained under `allOf`, so Pi preflight remains one-way compatible with authoritative Main Zod
validation. This rule is provider-neutral and has no LM Studio-specific runtime branch.

Protocol and tool contract version advance from 11 to 12. The Pi runtime remains the installed
0.80.10 version, and the Agent event schema remains version 3. Existing event arguments/results
remain opaque and readable; no database migration is required.

## Consequences

Ordinary writing calls carry nine core tools instead of the full writing surface. Broad tasks may
eventually activate every group, but pay that context cost only when requested. Shared guidance is
shorter and easier to update, Main retains every project and mutation check, and strict
OpenAI-compatible servers receive object-root function schemas.

This supersedes ADR 042 only where it requires every tool to repeat output, prerequisite, and
recovery prose and where it assumes a complete static writing envelope. ADR 017 prompt priority,
ADR 062 Notebook authority, proposal review, project capabilities, and Renderer isolation remain
unchanged.

## 2026-08-28 Compatibility Amendment

The initial object-root implementation used empty `properties` and placed the complete union only
under `allOf`. A real LM Studio GGUF run accepted that request but treated `read_section` as an
empty-argument tool, returning 370 `read_section({})` calls in one model response. Worker preflight
correctly rejected every call before Main dispatch. OpenAI-compatible strict loopback validation
had accepted the schema because it inspected `allOf`, so the original gate did not represent the
grammar sampler's field discovery behavior.

Root-union normalization must therefore expose the union's complete property vocabulary at the
root. The required set is the intersection of branch-required fields, identical properties remain
shared, and differing literal or enum discriminators merge into one enum. `additionalProperties`
is false only when every branch forbids extras. The unmodified union remains under `allOf` for exact
branch validation. This preserves the valid argument set for full JSON Schema consumers while
giving limited grammar samplers concrete fields and required common inputs.

## Alternatives Rejected

- UI-selected modes make ordinary requests depend on a manual choice and add product state.
- A classifier call adds latency, cost, and another model decision before the real task.
- Provider-specific schema rewriting would make equivalent models receive different contracts.
- An empty object wrapper with the union only under `allOf` passes superficial root checks but lets
  grammar samplers discover no arguments.
- Persisting activated groups would let a past run silently shape later authority and context.
- Removing Main enforcement would make hidden tools a presentation optimization rather than a
  defense-in-depth capability boundary.
