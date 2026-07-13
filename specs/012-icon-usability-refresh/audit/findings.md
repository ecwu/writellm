# Interface audit findings

Findings use `low`, `medium`, or `high` severity. A retained high finding is not
closed without separate product and accessibility approvals plus compensation.

| ID | Surface | Requirement | Severity | Finding | Disposition | Product approval | Accessibility approval | Compensation | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| F-001 | Shared controls | FR-009 | high | Small buttons and icon targets can compute below 44×44 CSS px. | resolved: 2.75rem minimum target | n/a | n/a | n/a | E-SHARED-DOM |
| F-002 | Outline | FR-001, FR-015 | high | Reorder buttons use Unicode arrow pseudo-icons. | resolved: Lucide arrows | n/a | n/a | n/a | E-US1-DOM |
| F-003 | Workspace/outline | FR-005 | high | Admitted icon-only actions need stable tooltip descriptions. | resolved: name + focus/hover/Escape tooltip | n/a | n/a | n/a | E-US2-MATRIX |
| F-004 | All | FR-002, FR-003 | medium | Canonical actions lack a consistent Lucide icon/name pairing. | resolved | n/a | n/a | n/a | E-US1-DOM |
| F-005 | All | FR-007, FR-010 | medium | Action groups need explicit hierarchy and enlarged-layout wrapping. | resolved in automated and live desktop matrices | n/a | n/a | n/a | E-US3-RUNTIME, E-US2-MATRIX |

No finding is retained. Any later retained high finding must populate both approval
columns with independent reviewers and provide a concrete compensation measure.
