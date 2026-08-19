# ADR 055: Textual Writing Skill Mentions

Status: accepted
Date: 2026-08-19

## Context

ADR 054 correctly removed Writing Skills as durable session or composer configuration, but it also
removed the direct discovery affordance that lets a user name an installed Skill without recalling
its exact canonical name. Ordinary prose remains valid, yet it is less precise and does not expose
which explicit-only Skills are available.

Writing Skill invocation should remain an Agent tool process. A composer affordance may help author
the request, but it must not become a second authorization channel, hidden attachment, persisted
selection, or silent prompt injection.

## Decision

- A new Agent run may begin with an ordered prefix of up to four canonical `$skill-name` tokens.
  The tokens are ordinary, editable prompt text and remain verbatim in the user message. The
  composer may autocomplete them from safe installed metadata, but sends no Skill IDs or selection
  object.
- Main reparses the original prompt and resolves exact canonical names against current application-
  global Skill authority. Unknown tokens grant nothing. Disabled, invalid, ambiguous, and excessive
  recognized mentions fail safely before any Skill content is disclosed to the model.
- A recognized mention authorizes only the pinned virtual entrypoint for that run. The Agent must
  still call `read_writing_skill`; no Skill body is injected silently. Mentioned Skills load in text
  order, dependencies remain mandatory, and downstream work or a final answer is rejected while a
  requested load is pending.
- Explicit-only Skills may appear in `$` autocomplete and the requested catalog but remain absent
  from automatic model discovery. After requested Skills settle, the Agent may discover additional
  complementary Skills within the existing shared limits.
- Autocomplete is available only for an idle composer starting a new run. Slash commands continue
  to control context. Steer and queued Follow-up messages do not reopen a run's closed Skill
  preparation phase.
- Version-3 run snapshots record ordered requested provenance plus whether each actually loaded
  top-level Skill came from a user mention or Agent discovery. This is immutable audit/replay state,
  not composer or session state. Historical snapshots remain readable.

ADR 054 remains authoritative for visible tool activity, reference budgets, preparation isolation,
safe projections, and the prohibition on executable Skill content or broader capabilities. This ADR
supersedes only its conclusion that the composer has no textual Skill invocation affordance.

## Alternatives considered

1. Restore a dropdown or persistent multi-select. This recreates session configuration and a second
   loading path.
2. Render selected Skills as chips or attachments. This hides part of the user's prompt behind
   Renderer-owned state and weakens copy/edit/history behavior.
3. Trust Renderer-supplied Skill IDs. This makes untrusted UI state an authorization input instead
   of deriving authority from the original prompt and Main-owned registry.
4. Reopen Skill preparation during Steer or Follow-up. This complicates active-run ordering and can
   invalidate already-built context; it is deferred unless a later decision redesigns run turns.

## Consequences

The Renderer needs safe registry metadata and caret-aware autocomplete, while Main gains one small
text parser and requested-load state. No IPC method, database migration, provider request, tool,
dependency, script, filesystem, network, or shell authority is added.
