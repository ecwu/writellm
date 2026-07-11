---
id: ADR-0004
title: Limit the MVP to an allowlisted local tool facade
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-004]
related_tasks: [PIA-007, PIA-008, PIA-012, PIA-014, SEC-001]
depends_on: [ADR-0002]
external_task_gates: [SEC-001]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0004: Limit the MVP to an allowlisted local tool facade

## Context

Article text, author instructions, and ingested sources are untrusted inputs. Giving a general-purpose agent ambient access to shell, filesystem, network, Git, settings, or raw database services would allow source text or prompts to expand its authority beyond a writing workflow.

## Decision

The MVP registers only these WriteLLM-owned tools:

- get_article_context;
- read_section_snapshot;
- search_knowledge;
- resolve_citation;
- inspect_citation_coverage; and
- propose_patch, which creates a review artifact rather than a persistent write.

All tools validate typed inputs, enforce workspace and section scope, honor cancellation, cap output, preserve provenance where applicable, and treat source text as evidence rather than instruction.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Register Pi's default shell, filesystem, Git, or browser tools | Rejected because they exceed the product's least-privilege writing scope. |
| Expose raw database or application service objects | Rejected because they bypass validation, output caps, and ownership checks. |
| Add web research in the MVP | Rejected because external network provenance, permission, and review policy need a separate decision. |

## Consequences and constraints

- No dynamic Pi extensions or user-installed tool packs are loaded in the MVP.
- Local retrieval returns bounded excerpts and source references, not unrestricted records.
- Prompt-injection defenses are product behavior, not an assumed property of the model.
- Any new privileged tool needs a new ADR, PRD amendment, author-visible approval design, and tests.
- Tool policy must conform to the accepted desktop threat model from SEC-001.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-001 | Define the product-wide threat model used to review the tool surface. |
| PIA-007 | Implement schemas, scope checks, output caps, tool policy, and default budgets. |
| PIA-008 | Ensure the sole write-like output is a reviewable patch proposal. |
| PIA-012 | Prove allowlist behavior, denial of forbidden operations, retrieval provenance, and injection handling. |
| PIA-014 | Include allowlist/provenance safety cases in evaluation and pilot evidence. |

### Completion conditions

- [ ] Runtime registration matches exactly the six MVP tools.
- [ ] Policy tests deny shell, arbitrary paths, raw Git, web/network, settings, direct apply, and raw database access.
- [ ] Retrieval and patch output carry bounded evidence provenance.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Migrated accepted PRD decision PIA-D-004 into the ADR register. |
