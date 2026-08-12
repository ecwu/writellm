# ADR 013: Downloadable Agent Writing Skills

Status: accepted; amended for Checkpoint 27.6
Date: 2026-08-10

## Context

WriteLLM's fixed Agent tool protocol already provides bounded manuscript reads, project-knowledge
retrieval, citation expansion, deterministic checks, typed proposals, and image generation. Its
prompt, however, is one global policy. The product cannot select a task-specific academic writing
method without either loading every method into every request or adding a bounded skill concept.

The architecture and the 2026-07-16 boundary audit deliberately excluded a generic plugin/skill
registry from the initial product. Adding one without a new decision would conflict with that
freeze. The current `@earendil-works/pi-agent-core` 0.80.10 package does expose application-provided
`Skill` resources and explicit `AgentHarness.skill()` invocation, but WriteLLM intentionally uses
the lower-level `Agent` so Main can own its existing session persistence, provider authorization,
tool bridge, proposal pause/continuation, and cancellation protocol. Migrating wholesale to
`AgentHarness` would duplicate or replace these accepted boundaries.

The desired writing methods live upstream: the Apache-2.0 `nature-skills` repository's
`nature-writing` skill (`Yuan1z0825/nature-skills`) and the MIT-licensed `CCFA-Skills` repository's
`ccf-paper-writer` and `ccf-humanization` skills (`mikubaka88/CCFA-Skills`). An earlier revision of
this ADR proposed vendoring adapted copies into application resources. That makes WriteLLM a
redistributor of adapted third-party text: Apache-2.0 §4 change notices and LICENSE/NOTICE
propagation would apply, and every adapted body would enlarge the signed-bundle audit surface.
Downloading skills on demand from upstream avoids redistribution entirely — the user fetches the
bytes directly under the upstream license — and keeps the signed bundle free of third-party skill
content.

The open ecosystem already has a downloader: Vercel's MIT-licensed `skills` CLI
(`vercel-labs/skills`, npm `skills`). Its evaluation is recorded under Alternatives.

## Decision

Ship no skill bodies. Ship a small curated catalog of metadata, and let users install skills on
demand — from the curated list or from a GitHub repository they choose themselves — through a
Main-owned, content-verifying downloader. Installed skills remain read-only text guidance: no
user-installed plugins in the executable sense, no skill-authored tools, no model-driven filesystem
discovery, no network authority for skills, and no direct mutation authority.

- The curated catalog carries only metadata per entry: stable ID, display name, description,
  upstream repository, skill directory path, a reviewed commit pin, SPDX license ID, declared
  dependencies, and a reviewed text-file allowlist. Every allowlisted file includes its expected
  size and git blob SHA. The first entries are `nature-writing`, `ccf-paper-writer`, and
  `ccf-humanization`. Every entry's pin and allowlist are reviewed like application code before the
  catalog ships. Files added upstream do not enter an installed curated skill until a later
  WriteLLM release reviews and publishes a new pin and allowlist.
- Users may also add a skill by GitHub `owner/repo` plus an optional directory path. Curated
  entries install at the reviewed pin; user-added entries pin the commit resolved at install time
  (trust on first use) and record it. Skills are never fetched by mutable ref or tag.
- Main owns the downloader. It resolves the pinned commit through the GitHub git-trees and blobs
  APIs, downloads only the selected skill directory, and verifies every file against its
  content-addressed git blob hash. Curated content must additionally match the catalog's expected
  blob SHA and byte size, so the GitHub tree response is not the only integrity anchor. Content
  must be UTF-8 text; binary files reject the install. Only selected `.md` and `.txt` files are
  downloaded; scripts, YAML sidecars, PDFs, images, templates, and other content never enter the
  installation. Writes land
  atomically in an application-owned directory under the app user-data path — never inside a
  project — via a temporary directory plus rename. Downloads run outside database transactions,
  use fixed GitHub endpoints only (no arbitrary URLs; GitHub-only in the first version), carry
  correlation IDs, and emit structured lifecycle logs. Anonymous API rate limits surface as safe,
  actionable errors. The runtime never shells out to `npx`, the `skills` CLI, `git`, or `gh`.
- Installed skill content is user-installed third-party text, not application code and not project
  content. It stays below the global safety, citation, tool-authority, and trusted/untrusted-data
  policies, which it cannot override. The installer records provenance — repository, commit,
  per-file hashes, SPDX license, fetch time — and the Agent surface displays source and license
  with attribution. Because WriteLLM redistributes nothing, no NOTICE or derivative-work
  obligations arise from the skills themselves.
- Explicit prompt assembly loads the complete primary and dependency `SKILL.md` entrypoints on
  every turn; optional reference files remain progressively readable. A skill that cannot fit is
  rejected at validation, never silently
  truncated. `MAX_SYSTEM_PROMPT_BYTES` remains 65,536 bytes. Catalog tests freeze the measured
  UTF-8 byte cost of `buildAgentPolicy()`, the companion note, Pi's invocation wrapper, and the
  fixed XML/JSON envelope; policy or companion changes intentionally fail that measurement test
  until the budget is reassessed. Custom skills are limited to a fully formatted `SKILL.md` of at
  most 24 KiB, at most 48 KiB across all installed text, at most 32 `.md`/`.txt` files, and at most
  8 KiB per reference file. Entrypoints, dependencies, and references are never truncated. An
  application-owned companion note — WriteLLM's own text, shipped with the app —
  states the fixed thirteen-tool set and converts references to unavailable capabilities (shell,
  arbitrary files, `.bib` mutation, external literature search, subagents, other skills) into
  explicit evidence gaps. The final system prompt remains under the existing 65,536-byte bound
  (`MAX_SYSTEM_PROMPT_BYTES` in `src/main/agent/context.ts`); catalog validation must prove at
  startup that every mandatory assembly — global policy, companion note, one primary skill, and
  its dependency closure — fits the bound while retaining a small reference-file reserve.
- Skill activation is stored per session and snapshotted per run as `auto | explicit | none`; new
  sessions default to `auto`.
  `auto` considers enabled, integrity-verified skills that permit model invocation, `explicit`
  fixes one enabled, integrity-verified primary skill selected for that run, and `none` disables
  skill use. At most one primary writing-method skill is active per run, plus its declared dependencies;
  `ccf-humanization` may be a declared dependency of `ccf-paper-writer`. Dependencies resolve only
  within the curated catalog — user-added skills have no dependencies — and catalog validation
  rejects unknown or cyclic dependencies at startup. Venue or style methods with conflicting rules
  are never co-active.
- Persist every run's bounded skill provenance in `agent_runs.skill_snapshot_json`: requested
  mode, selected primary and dependencies, commit pins, hashes, loaded resource paths, routing
  status, and safe errors. Historical `agent_runs.skill_route_model_request_id` and
  `model_requests.delivery = 'skill_route'` data remain readable, but new runs create no pre-route
  request. `listRuns` exposes only their bounded token/cost/retry usage so historical Renderer
  totals remain complete. The project migration is additive. Skill bodies stay global and never enter project
  databases, Renderer projections, durable tool events, or logs. Structured lifecycle logs carry
  bounded IDs and pins, never full prompt bodies.
- No automatic updates. A curated skill's update check compares its installed pin only with the
  reviewed pin in the current application catalog; it never follows the upstream default branch.
  A custom skill may inspect the upstream default branch for a new immutable commit, but the UI
  labels it an unreviewed update and installs it only after explicit confirmation. That mutable-head
  check result is Renderer-ephemeral; Main persists only the confirmed immutable pin. Existing
  runs retain their snapshot. Uninstall deletes only files Main itself wrote.
- Main performs startup integrity revalidation. Missing or hash-mismatched files mark an installed
  skill unavailable instead of silently dropping it. Settings exposes the safe reason plus
  Reinstall and Uninstall; no private path is shown. Curated reinstall uses the catalog's reviewed
  pin, while custom reinstall defaults to the recorded commit.
- Auto mode performs no auxiliary model request. The formal turn receives enabled,
  integrity-ready, model-invocable Skill name/description metadata through Pi's catalog formatter.
  The model may use `read_writing_skill` to read one candidate entrypoint; that first successful
  read atomically locks the run to one primary and supplies its dependency entrypoints. It may then
  read at most four manifest-listed primary references. Explicit mode freezes its primary and
  dependency closure at run start and injects their complete entrypoints on every turn while
  retaining the same lazy reference capability. A selected explicit Skill that becomes unavailable
  blocks new runs without silently changing the session setting.
- Writing Skill reads are a preparation phase rather than independent downstream reads. Explicit
  mode does not reread an entrypoint already injected into the system prompt. Auto reads at most one
  candidate entrypoint in an otherwise Skill-only assistant response. The model may then issue up to
  four task-relevant reference reads together, but waits for every selected result before using
  manuscript, knowledge, citation, generation, checking, or submission tools in a later response.
- Prompt order is fixed: global safety/tool/writing/citation policy, companion note, Pi-formatted
  primary/dependency blocks and complete references, trusted writing requirements, then manuscript
  data. Optional references are removed whole before the existing outline reduction. If mandatory
  entrypoints still do not fit, auto falls back to none and explicit fails with
  `skill_prompt_budget_exceeded`.
- Adopt Pi's exported skill primitives where they fit the low-level `Agent`; all of them are
  re-exported from the package root and none requires `AgentHarness`. The `Skill` type
  (`name`, `description`, `content`, `filePath`, `disableModelInvocation?`) is the in-memory
  shape of a loaded skill, extended with WriteLLM provenance (commit pin, per-file hashes,
  license) through the same `TSkill extends Skill` generic pattern Pi itself supports.
  `loadSourcedSkills` validates the manifest-backed virtual resource view,
  `formatSkillsForSystemPrompt` supplies Auto's progressive-disclosure catalog, and
  `formatSkillInvocation` supplies the model-visible `<skill name="…" location="…">` block
  format for the prompt section, so WriteLLM does not invent its own wrapping. Installer
  validation adopts Pi's `SKILL.md` metadata rules — a required `description` of at most
  1,024 characters, a `name` of at most 64 lowercase-hyphen characters matching the skill
  directory, and the optional `disable-model-invocation` flag — so any agentskills.io-compatible
  skill installs unchanged. A skill's model-visible `location` is a virtual `writellm://skills/…`
  URI, never an absolute user-data path; prompts sent to providers must not carry private
  filesystem paths.
- Pi runs only over a manifest-backed, read-only virtual `ExecutionEnv`. It cannot write, shell,
  enumerate arbitrary directories, follow symbolic links, or resolve real paths. Pi diagnostics
  and WriteLLM's stricter metadata/integrity rules are both fail-closed. The bounded
  `read_writing_skill` tool accepts only virtual URIs pre-authorized for the run, so progressive
  disclosure adds no generic filesystem authority. `AgentHarness.skill()` remains unused because
  it delivers the skill as a user-turn message and requires the harness; WriteLLM keeps explicit
  invocation in the ordered system prompt. A later migration from the low-level
  `Agent` to `AgentHarness` requires separate evidence that its session, hook, retry,
  compaction, and tool lifecycle semantics preserve WriteLLM's current protocol.

## Alternatives considered

1. Vendor adapted skill bodies into application resources (this ADR's previous revision). It makes
   WriteLLM a redistributor of adapted third-party text — Apache-2.0 §4 change notices, LICENSE/
   NOTICE propagation — and grows the signed-bundle audit surface for content that users can fetch
   from upstream themselves.
2. Bundle or shell out to Vercel's `skills` CLI. The CLI is interactive-first with no library API,
   requires Node >= 22.20 plus system `git`/`gh` at runtime, orchestrates symlinks across 70+
   agent targets WriteLLM does not have, emits telemetry that must be suppressed, resolves through
   a registry fast path with known correctness bugs (for example `vercel-labs/skills#1469`, which
   installed a 1,831-file monorepo instead of one skill), and couples product behavior to another
   tool's flags and release cadence. WriteLLM needs only its GitHub-download happy path — pinned
   fetch plus hash verification plus size caps — which is small enough to own in Main.
3. Run `npx skills` at install time. A desktop Electron product cannot assume Node/npm on the
   user's machine.
4. Let the model discover `SKILL.md` files in project or user directories. This grants a new
   filesystem/prompt-injection surface and breaks project portability and the fixed authority
   model.
5. Load all skill bodies in every run, or keep one global prompt forever. The first wastes the
   bounded system context and creates conflicting venue/style rules; the second cannot express
   explicit, inspectable, task-specific writing methods.
6. Migrate immediately to Pi `AgentHarness`. This gains native resource APIs but risks replacing
   stable WriteLLM persistence, provider-call authorization, retry, proposal review, and event
   semantics without product evidence.

## Migration and roadmap impact

An approved implementation needs a focused checkpoint covering: curated-catalog contracts and
startup validation; the Main downloader (GitHub trees/blobs, git-hash verification, deterministic
caps, atomic user-data storage, provenance manifest); IPC contracts exposing bounded metadata,
install/update/uninstall commands, and add-by-repository to Renderer; a compact shadcn skill picker
in the Agent surface showing source, license, install state, and version; Main-owned prompt
composition with the companion note, reusing Pi's `Skill` type and `formatSkillInvocation` block
format; per-run snapshot semantics; event/model-request observability;
compatibility for existing sessions; focused Main/Worker/Renderer tests with mocked network; and a
real-Electron grounded-writing scenario. It does not authorize a skill marketplace, executable
plugins or skill-authored tools, new Agent tools, arbitrary URL fetching, automatic updates, hosted
CI, packaging, release, push, or promotion.

Checkpoint 27.3 is already locally complete with the global-policy-only scope this ADR permits; it
added no skill catalog, downloader, selector, persistence migration, or Pi harness migration.
Implementing this ADR requires explicit acceptance and a new dedicated checkpoint scoped as above.
