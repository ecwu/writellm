# ADR 023: Selection-Based Quick AI Actions

Status: accepted for Checkpoint 31
Date: 2026-08-12

## Context

WriteLLM already captures a section revision and selected block IDs when a user starts an Agent
turn with selection scope. It also already owns model choice, Thinking, Writing Skill, context,
approval, immutable run snapshots, proposal review, stop/steer, usage, and citation provenance.
What is missing is a direct, keyboard-accessible entry from an exact text selection. A toolbar that
calls a provider or edits inline would duplicate the Agent runtime and bypass proposal review.

The current selection projection identifies blocks but not the exact selected text. Quick actions
need a visible frozen snapshot and must fail when the editor selection or canonical revision changes
before Main accepts the request.

## Decision

Add seven fixed application commands: rewrite, shorten, expand, adjust tone, check evidence, align
with manuscript, and custom instruction. Their identifiers and bounded custom input are shared
contracts, while all task prose is Main-owned under `src/main/agent/prompts/`. Selected manuscript
text is wrapped as non-instructional dynamic data; the chosen task and custom instruction are a
separate application-owned instruction block. The evidence template explicitly permits a complete
review-only response with no mutation proposal.

Quick actions always target the currently visible ordinary Agent conversation. If no persisted
conversation is visible, the existing draft conversation is created on first quick-action send.
The application does not create or search for a dedicated quick-action conversation. If that
conversation is running, compacting, generating, awaiting review, archived, missing a model, or the
project is at Agent capacity, the action fails explicitly and leaves the frozen selection intact.
This deterministic policy preserves its selected model, Thinking level, Writing Skill, context
scope, and approval policy.

Renderer captures `{sectionId, capturedRevisionId, capturedAt, activeBlockId, ordered unique
selectedBlockIds, selectedText}` with 1–16,384 UTF-16 code units. The selection menu is available
only for a non-empty text selection. Before sending, the editor flushes and recaptures; section,
block order, and text must be identical, while the post-flush current revision becomes the submitted
revision. Main then requires that revision to remain current, every selected block to exist, and the
exact selected text to occur within the ordered selected-block visible text. Failure starts no run.

The toolbar is one compact shadcn-compatible control inside BlockNote's formatting toolbar. It
opens a grouped menu with labels and descriptions; `Cmd/Ctrl+Shift+K` opens the same menu while a
selection is active. Custom instruction uses a titled, focus-managed dialog with the frozen
selection preview. Narrow layouts retain the compact trigger and use a viewport-bounded menu.

Main persists the generated task as the ordinary user message and adds bounded presentation
metadata containing only the action ID/label, optional display instruction, and exact selected
text. The Agent timeline renders that snapshot, so a review-only completed response is visibly a
successful normal turn. All provider work and mutations continue through the existing start-run,
tool, proposal, and approval paths.

## Consequences

CP31 adds no provider runtime, Agent tool, mutation type, database migration/table, durable job,
inline direct write, Renderer authority, prompt registry, or reusable user preset. Exact selection
text is intentionally persisted with the normal Agent user event and run context, within the
existing 64 KiB editor-context and 2 MiB event bounds.

The selected text check is an authorization/relevance guard, not a character-offset mutation
capability. The Agent must still read canonical blocks and submit the existing typed proposal; Main
continues to bind and revalidate the proposal's source snapshot and revision.
