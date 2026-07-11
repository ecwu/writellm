---
id: ADR-0003
title: Preserve the human-reviewed WritingPatch boundary
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-003]
related_tasks: [PIA-008, PIA-010, PIA-012, PIA-013, PIA-014]
depends_on: [ADR-0002]
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0003: Preserve the human-reviewed WritingPatch boundary

## Context

WriteLLM already protects document integrity through a typed WritingPatch, anchors, validation, warnings, explicit author approval, and a Git checkpoint. A multi-turn agent must not gain a second, weaker mutation path.

## Decision

An agent may create only a typed proposal that enters the existing WritingPatch validation and review flow. The author alone can apply, save as candidate, or reject the patch. The agent cannot call direct document, outline, settings, database, filesystem, or apply APIs.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Let a successful agent write Markdown directly | Rejected because it bypasses anchors, risk validation, user review, and Git checkpoint safeguards. |
| Implement a separate agent-specific patch writer | Rejected because duplicate validation logic can drift from the current protected path. |
| Auto-apply only low-risk changes | Out of scope for the MVP; it requires a separate approval, threat-model, and UX decision. |

## Consequences and constraints

- Agent output includes scope, anchors, provenance, diff, and validation outcome.
- Existing citation, number, Markdown, LaTex, and stale-patch protections continue to run.
- A successful run is not evidence of a document mutation; a user review action remains necessary.
- UI language must distinguish an agent proposal from an author Apply action.

## Linked implementation work

| PIA task | Contribution to this decision |
| --- | --- |
| PIA-008 | Bridge final agent output to the existing proposal and validator flow. |
| PIA-010 | Present existing review actions and warnings in the agent experience. |
| PIA-012 | Exercise direct-write denial, stale patch, and validator behavior deterministically. |
| PIA-013 | Smoke-test the no-direct-write, human-reviewed lifecycle. |
| PIA-014 | Evaluate evidence-grounded revisions without weakening the human-review boundary. |

### Completion conditions

- [ ] No agent tool or event path can invoke document mutation or acceptWritingPatch.
- [ ] A valid proposal has the same review semantics as an existing generated patch.
- [ ] Tests and smoke evidence prove no section Markdown changes before author approval.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Migrated accepted PRD decision PIA-D-003 into the ADR register. |
