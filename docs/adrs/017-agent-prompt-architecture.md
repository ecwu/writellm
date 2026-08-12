# ADR 017: Agent Prompt Architecture

Status: accepted for Checkpoint 28.3
Date: 2026-08-12

## Context

WriteLLM's Agent prompt behavior is application-owned, but its text and composition are spread
across the writing policy, context builder, Writing Skill utilities, session service, application
bootstrap, and Agent IPC. The runtime behavior is bounded and tested, yet the source layout makes
ownership, precedence, dynamic-data trust, and prompt-budget impact difficult to review together.

OpenAI Codex keeps base behavior separate from collaboration-mode and bounded task templates such
as compaction, then composes runtime context through explicit instruction layers. WriteLLM has a
narrower academic-writing authority boundary and supports provider-neutral models, so copying
Codex's full coding-agent prompt or introducing model-specific prompt variants would add noise and
drift rather than improve the product.

## Decision

Keep all application-owned Agent prompt text and composition under `src/main/agent/prompts/`, split
by responsibility:

- base policy defines identity, authority, collaboration, academic-writing, and citation behavior;
- system composition owns the fixed precedence of global policy, Skill guidance, trusted writing
  requirements, and manuscript data;
- the Writing Skill companion describes the fixed capability mismatch and preparation barrier;
- bounded task templates own title generation, conversation checkpoint compaction, tool
  continuation, and proposal-review continuation.

Prompt precedence remains: application safety and tool authority; application collaboration,
writing, and citation policy; application Skill companion; installed Skill entrypoints and selected
references; trusted writing requirements; untrusted manuscript data; durable conversation history;
and the current user request. Installed Skills and dynamic content cannot override an earlier
application layer.

Every application-wrapped dynamic payload uses a named delimiter and escapes delimiter-significant
characters before composition. Each block states whether its content has instruction semantics.
This applies to project context, Skill references, conversation material used for titles or
compaction, and Main-authored review-continuation context. It does not reclassify the current user
request or trusted brief requirements as untrusted.

Keep one provider-neutral prompt contract. A provider- or model-specific fork requires a later ADR
with measured behavioral evidence, a fallback, and parity tests. Prompt changes remain source
changes: no runtime prompt editor, database table, Renderer projection, or full-prompt logging is
introduced.

Verification freezes the ordered layer contract, escape behavior, task-template invariants, and
the existing 65,536-byte system-prompt budget. Full prompts, Skill bodies, manuscript content, and
conversation content remain excluded from logs.

## Consequences

The prompt surface becomes reviewable without changing Agent Harness Protocol v4, the thirteen
registered tools, proposal approval, request-scoped execution, provider transport, or persistence.
Codex-inspired improvements are adopted only where they fit WriteLLM: concise progress updates,
outcome-focused responses, bounded autonomy, dedicated checkpoint summaries, separate task
templates, and explicit context layering.

Existing Agent events and model requests remain readable. This checkpoint needs no migration and
adds no network, filesystem, shell, plugin, subagent, or direct manuscript-write authority.
