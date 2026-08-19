# ADR 054: Observable Per-Run Writing Skill Loading

Status: accepted
Date: 2026-08-19

## Context

ADR 053 modeled Writing Skill composition as a durable session choice, with Explicit, Auto, and
No Skill controls in the composer. Hands-on review showed that this makes a dynamic Agent action
look like conversation configuration. It also creates two execution paths: Explicit Skills are
silently injected before the provider call, while Auto Skills are visibly loaded through
`read_writing_skill`.

A Writing Skill is guidance the Agent may discover and load while preparing a response. A user may
name a Skill in ordinary language, or the Agent may decide from the same metadata catalog that a
Skill is useful. Neither case requires a Renderer-owned selection state. Both cases should produce
the same inspectable tool activity before the guidance can affect downstream work.

## Decision

Checkpoint 60 supersedes ADR 053's session selection, Explicit pre-injection, project migration
0037, composer/message selection chips, and editable Agent Details control. ADR 053's bounded
multi-Skill provenance, resource budgets, immutable versions, and security boundaries remain in
force where they do not conflict with this decision.

- Writing Skills are not session state. The composer and Agent Details expose no Skill selector,
  mode, badge, chip, or persisted preference. Existing `skill_mode` and `skill_id` database columns
  remain unused compatibility data; Checkpoint 60 adds no project migration.
- Every new Agent run receives the same bounded Pi-formatted catalog of enabled Skill names,
  descriptions, and exact virtual entrypoint URIs. No classifier, embedding router, or additional
  model request is introduced. The active Agent model decides whether to call
  `read_writing_skill` from the catalog and the conversation, including an ordinary-language user
  request to load a named Skill.
- Skill content enters a run only as the result of `read_writing_skill({ uri })`. There is no
  silent Explicit injection. A successful entrypoint read authorizes its dependency entrypoints
  and reference URIs; those files are also read through named tool calls rather than hidden file
  access. One Skill-only assistant response may add at most one new entrypoint. A run may load at
  most four top-level Skills, eight deduplicated dependencies, and twelve complete references
  totaling at most 32 KiB.
- The preparation barrier remains: a response containing Skill reads contains no other tool kind,
  and downstream writing, retrieval, checking, generation, or proposal tools start only after the
  current Skill read settles. Once downstream tool work begins, Skill discovery for that run is
  closed. Duplicate reads are idempotent and consume no additional budget.
- The immutable version-2 run snapshot records only what was actually loaded: ordered top-level
  Skills, dependencies, and retained references with display name, commit, relative path, hash,
  and byte count. It never records Skill bodies or private paths. Retry authorizes the exact
  recorded versions and resources and reproduces their loading as visible tool activity; a missing
  pinned version fails closed. Historical version-1 snapshots remain readable.
- The timeline renders each `read_writing_skill` call as named, expandable progress: loading,
  loaded entrypoint, loaded dependency, or read reference. Completed groups may collapse, but Skill
  names and file counts remain visible. Agent Details is read-only provenance derived from actual
  tool results and the run snapshot. If no Skill tool call occurred, the UI makes no claim that a
  Skill was used.
- Renderer-safe persistence and logs contain only safe IDs, display names, commits, relative paths,
  counts, byte sizes, hashes, durations, and error codes. Virtual URIs, bodies, credentials, and
  private absolute paths stay out of normal timeline content and structured logs.

## Alternatives considered

1. Keep a session-level multi-select and treat it as a prompt preset. This is predictable but
   misrepresents loading as durable conversation configuration and bypasses observable tool use.
2. Add per-message Skill attachments or composer chips. This removes persistence but still creates
   a second selection protocol that ordinary language and the Agent tool loop do not need.
3. Infer and persist Explicit versus Auto with a hidden classifier. Natural-language intent is not
   reliably reducible without another opaque request, and actual tool provenance is the important
   audit fact.
4. Load all enabled Skills at run start. This wastes context, increases instruction conflicts, and
   erases the model's progressive discovery decision.

## Migration and roadmap impact

Checkpoint 60 removes the unshipped migration 0037 and all session-selection IPC/Renderer work.
Existing projects reopen without schema changes; legacy session Skill values are ignored and the
next run receives the ordinary metadata catalog. Runtime, snapshot, activity, replay, and safety
tests replace selection-persistence coverage. The checkpoint still adds no executable Skill
content, arbitrary discovery, filesystem/network/shell authority, custom tools, provider,
dependency, marketplace, update mechanism, package/release action, or multi-agent capability.
