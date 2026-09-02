# ADR 073: Explicit Writing Skill Injection and Non-Blocking Auto Loading

Status: accepted
Date: 2026-09-01

## Context

ADRs 054 and 055 made every Writing Skill entrypoint visible as a
`read_writing_skill` tool call and rejected downstream work or a final answer until every requested
root and dependency had been read. In practice, a leading `$skill-name` is an explicit user request
for instruction context, not a request that the model independently rediscover the same Skill.
The preparation detector could therefore fail an otherwise useful answer even after the requested
entrypoint had visibly been read, while retry also reproduced an obsolete Skill snapshot instead of
consulting the current application-global registry.

WriteLLM still needs progressive, inspectable automatic discovery. It also needs deterministic,
atomic semantics when a user explicitly names one or more Skills, including transitive dependency
composition and failure behavior that never applies only half of a rule set.

## Decision

- Main reparses up to four leading canonical `$skill-name` tokens from the original user text. It
  never trusts a Renderer-supplied Skill ID. Unknown names remain ordinary prompt text.
- Before the first provider request, Main resolves every recognized top-level Skill and its complete
  dependency closure from current application-global authority. Top-level Skills retain user-text
  order and precede dependencies; dependencies use stable topological order and shared dependencies
  are deduplicated.
- The explicit set is one atomic prompt package using the existing escaped Writing Skill wrapper.
  Missing or invalid roots or dependencies, ambiguity, cycles, count limits, integrity failures, or
  prompt-budget failure prevent the entire package from being injected. The run continues with the
  ordinary Agent context and the still-valid automatic metadata catalog. Its schema-v3 snapshot is
  `explicit`/`degraded`, records no un-injected Skill provenance, and retains a bounded safe error.
- Successful explicit injection records the current immutable top-level and dependency provenance
  as `selected` before the first provider request. It emits no synthetic tool use, timeline loading
  card, badge, chip, attachment, or extra provider request. Its roots and dependencies immediately
  authorize their bounded reference capabilities for optional `read_writing_skill` reads.
- Automatic mode remains progressive and visible. The model may read one new root or dependency
  entrypoint per Skill-only assistant response and may read authorized references within the
  existing count and byte limits. Dependencies are recommended for complete use, but unread or
  failed dependencies do not suppress assistant text, block downstream tools, reject a final
  answer, or fail run settlement. A protocol violation remains an ordinary recoverable tool error.
- Main no longer emits `skill_request_unfulfilled` for new runs. Its parser and historical Renderer
  label remain so existing records can still be opened and understood.
- Every new run, including proposal continuation and user retry, routes from the original current
  prompt and the registry state available at that time. A previous run's Skill snapshot is immutable
  audit evidence only and is never replay authority. The memory-only same-request provider retry in
  ADR 071 remains unchanged because it resumes the same live run rather than creating a new run.
- Structured logs retain only mode, safe IDs, immutable commits, counts, failure codes, and timing.
  Bodies, credentials, virtual capability strings, and private paths remain prohibited from normal
  logs and timeline persistence. Existing diagnostic-trace content policy remains unchanged.

This decision supersedes ADR 054's requirements that all Skill content enter only through visible
tool reads and that retries reproduce recorded Skill loading. It supersedes ADR 055's requirements
that recognized mentions merely authorize ordered reads and that pending requested Skills or
dependencies block downstream work or final answers. ADRs 053–055 otherwise remain authoritative
for bounded composition, immutable provenance, safe projection, reference budgets, tool isolation,
and the prohibition on executable Skill capabilities.

## Alternatives considered

1. Keep only automatic tool loading. This preserves one mechanism but makes explicit `$skill-name`
   requests probabilistic and leaves correctness dependent on a model following a preparation
   ritual.
2. Inject every automatically selected Skill. That would hide model discovery, increase prompt
   conflicts, and erase observable progressive reads.
3. Inject roots but leave dependency composition to later tool calls. A failed or skipped
   dependency could apply a partial explicit ruleset, contrary to the user's direct request.
4. Keep the final-answer detector as a warning. Main cannot reliably infer whether partial guidance
   is semantically required, and a system-level detector should not override a valid model answer.

## Consequences

Checkpoint 82 changes routing, prompt composition, run settlement, retry routing, and one bounded
Renderer warning. It reuses snapshot schema v3 and the existing tool protocol. It adds no migration,
persistent Skill selector, attachment, chip, classifier, provider request, dependency, executable
content, or filesystem/network authority. Historical `skill_request_unfulfilled` data remains
readable.
