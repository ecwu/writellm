# ADR 053: Composable Progressive Writing Skills

Status: accepted
Date: 2026-08-19

## Context

ADR 013 established application-global, immutable, text-only Writing Skills with a Pi-formatted
metadata catalog, exact virtual resource capabilities, progressive reference reads, and one
session-level `auto | explicit | none` selection. Hands-on use exposed two product gaps: a task may
need more than one complementary method, and the Agent timeline does not clearly distinguish an
explicit user choice from an automatic Skill load or identify the files that were read.

Codex supports multiple structured Skill mentions and records explicit and implicit invocation
separately. OpenCode exposes Skill loading as a named tool result with the loaded file inventory.
Pi keeps only bounded name, description, and location metadata in the initial prompt and loads the
full instructions progressively. WriteLLM can combine those properties without adopting a generic
plugin system or changing its existing Main-owned session, persistence, tool, and proposal
boundaries.

## Decision

Checkpoint 60 replaces ADR 013's single-primary and four-primary-reference restrictions with one
bounded, ordered, reproducible composition model. All other ADR 013 provenance, installation,
integrity, and authority rules remain in force.

- A session owns `{ mode: 'auto' }`, `{ mode: 'explicit', skillIds }`, or `{ mode: 'none' }`.
  `skillIds` is an ordered, distinct list of one to four enabled, integrity-ready top-level Skills.
  Existing `{ mode: 'explicit', skillId }` values normalize to a one-element list.
- A run snapshot uses schema version 2 and records the ordered top-level Skills, the deduplicated
  dependency closure, and every retained reference as immutable provenance. New provenance records
  include the installation display name. Historical version-1 snapshots normalize in memory by
  treating `primary` as the first top-level Skill and assigning its path-only references to that
  Skill. Skill bodies remain absent from project SQLite and Renderer projections.
- The project session table gains an ordered `skill_ids_json` column. The historical `skill_id`
  column remains a compatibility shadow of the first explicit ID. Forward migration backfills a
  singleton array; new writes keep both representations consistent. Main/shared validation owns
  ordering, distinctness, ID validity, and the four-Skill limit.
- Explicit mode resolves all selected Skills and a combined dependency closure before the run
  starts. A selected Skill that also appears in another selected Skill's dependency closure is
  injected once as a top-level Skill. Shared dependencies are injected once. The total dependency
  closure remains limited to eight.
- Auto keeps the existing Pi metadata catalog and makes no auxiliary model request. One Skill-only
  assistant response may add at most one previously unselected top-level Skill, so the model sees
  the current composition before requesting another. One run may select at most four. A duplicate
  read is idempotent.
- Instruction precedence is application safety/tool/writing policy, ordered top-level Skills, then
  dependency Skills. Earlier top-level selections have higher precedence. Dependencies are emitted
  in stable topological order below all top-level Skills. This ordering is explicit in the
  application companion text and is not inferred from installation order.
- Every selected top-level Skill and dependency contributes its exact manifest reference allowlist.
  References are keyed by `skillId + commit + relativePath`, may be read only through the existing
  `read_writing_skill({ uri })` tool, and are limited to twelve distinct complete files and 32 KiB
  total per run. Count and byte reservations happen before asynchronous reads; failures release the
  reservation. Duplicate reads consume neither budget twice nor another snapshot entry.
- Mandatory entrypoints and catalogs must still fit the existing 65,536-byte Skill prompt budget.
  Explicit selection fails before provider activity when the composition cannot fit. Auto checks a
  prospective composition before committing a new top-level Skill and leaves the existing set
  unchanged on rejection. Optional references continue to be removed whole, never truncated.
- The preparation barrier remains. Auto may load one new entrypoint in a Skill-only response and
  may read independent authorized references together in a later Skill-only response. Manuscript,
  knowledge, checking, generation, and submit tools run only after the selected Skill reads settle.
- User-visible provenance has two layers. Explicit Skills appear as compact chips on the composer
  and the resulting user message. Auto entrypoint/reference reads appear as named, expandable
  activity with the Skill display name and relative file. Agent Details shows Auto/Explicit,
  top-level order, dependencies, short commits, and retained references. Normal timeline content
  never exposes virtual URIs, bodies, or private paths.
- Structured lifecycle logs cover selection preparation, entrypoint load, reference load, and
  rejection with bounded IDs, mode, counts, bytes, and durations. Original errors are logged as
  top-level `err` before safe projection; bodies and private paths are never logged.

## Alternatives considered

1. Keep a single primary and require users to merge methods manually. This preserves the current
   implementation but does not support cross-Skill writing workflows.
2. Load every enabled Skill in Auto mode. This wastes bounded context, increases instruction
   conflicts, and makes the run difficult to audit or reproduce.
3. Add a hidden classifier or embedding router. This adds another model request and failure surface
   without improving the model's existing metadata-based choice.
4. Add executable scripts, skill-authored tools, or arbitrary filesystem discovery. These cross the
   accepted Renderer/Main/tool authority boundary and remain explicitly out of scope.
5. Move to Pi `AgentHarness`. It does not preserve WriteLLM's project-local event persistence,
   provider-call authorization, proposal pause/continuation, compaction, and retry semantics.

## Migration and roadmap impact

Checkpoint 60 requires shared-contract compatibility, project migration 0037, Main runtime and
session changes, prompt/context accounting, Renderer presentation, durable event projection, and
focused Main/Renderer/Real-Electron verification. It adds no new Agent tool, worker role, provider,
dependency, network endpoint, package/release work, marketplace, auto-update, executable Skill,
per-turn override, or multi-agent capability.
