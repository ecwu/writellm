# ADR 016: Agent Progress Visibility And Quick Controls

Status: accepted for Checkpoint 28.2
Date: 2026-08-12

## Context

Checkpoint 28.1 reduced the Agent surface to one continuous conversation, but it over-corrected
progressive disclosure. Model, Thinking, Writing Skill, and approval policy moved behind one
Details dialog even though writers change them frequently. During a long run, the persistent
status reports only `Working` while the activity timeline compresses tool work into a summary that
does not reveal its individual human-readable steps. The writing policy also discourages process
narration broadly, so capable models often execute several tool phases without a concise visible
statement of intent or findings.

The user supplied the Codex task surface as the interaction reference: a composer with frequently
changed controls in its footer, assistant progress prose alternating with tool activity, and a
compact activity summary that expands to individual operations.

## Decision

The Agent composer keeps context, approval policy, model, Thinking, and Writing Skill directly
available as compact shadcn controls. The same values remain in Details for diagnostics and the
existing run/review/image-generation snapshot lock remains authoritative. Labels may truncate
within their allocated desktop controls, but must not remove controls from the default composer.

The running status names the current user-facing activity and elapsed time instead of displaying a
generic `Working` label. Activity groups expand to human-readable individual steps with status and
duration. Raw tool names, bounded arguments/results, provider metadata, token usage, and Skill
commit details remain in Details.

The Agent operating policy asks for brief user-visible progress messages before the first
substantial tool phase and between materially different phases. These messages report intent,
observable findings, and the next action; they must not expose hidden reasoning or narrate every
trivial operation. Existing assistant-message and tool events provide the alternating timeline, so
no event type, persistence table, worker role, or migration is added.

Completed runs show their elapsed duration without restoring a generic `Run completed` event.

## Consequences

This decision amends ADR 015 only where it placed all frequently changed controls exclusively in
Details and minimized successful-run duration. It preserves Agent Harness Protocol v4, registered
tool boundaries, typed proposals, revision revalidation, approval authority, request-scoped
cancellation, immutable run snapshots, the Renderer trust boundary, and all current persistence.

The primary conversation becomes more observable and configurable, at the cost of a denser
composer footer. Compact labels and official controls keep the configured desktop sidebar usable
without hiding the choices.
