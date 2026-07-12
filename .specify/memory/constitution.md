<!--
Sync Impact Report
- Version change: 2.0.0 → 3.0.0
- Modified principles: five project-specific foundation principles → four stable,
  cross-feature governing principles
- Removed from Constitution: milestone scope gates, repository-specific paths and
  tags, concrete commands, concrete Electron settings, and detailed test taxonomy
- Added sections: none
- Templates requiring updates: ✅ .specify/templates/plan-template.md
- Templates reviewed without changes: ✅ .specify/templates/spec-template.md;
  ✅ .specify/templates/tasks-template.md; ✅ .specify/templates/constitution-template.md
- Command templates: ⚠ none present under .specify/templates/commands/
- Follow-up: operational details remain governed by AGENTS.md, project docs, and CI
-->

# WriteLLM v2 Constitution

## Core Principles

### I. Secure Desktop Boundary

Renderer processes MUST be treated as untrusted boundaries. Designs MUST apply
least privilege and MUST NOT give the renderer direct access to Node.js or Electron
capabilities. Any boundary exception MUST be explicit, narrowly scoped, and
justified during plan review. This principle protects users across every feature,
regardless of the specific Electron implementation used.

### II. Typed, Minimal IPC

The preload layer MUST expose only named, typed capabilities required by the
renderer. Generic IPC access and broad capability wrappers MUST NOT cross the
preload boundary. IPC contracts MUST be defined in shared types, and changes MUST
include verification that the exposed contract is intentional and minimal.

### III. Specification-Driven, Minimal Evolution

Every feature MUST have an accepted specification and implementation plan before
implementation begins. Unresolved decisions that cross system, process, or durable
boundaries MUST be recorded in an ADR before implementation. Teams MUST choose the
smallest design that satisfies the accepted requirements rather than adding
complexity for hypothetical needs. Every Constitution exception MUST be recorded
with its rationale, impact, and approval in the plan's Complexity Tracking.

### IV. Verification at the Failure Boundary

Changes MUST be verified at the lowest level capable of detecting the relevant
failure. Static checks alone are insufficient for behavior that crosses a process
boundary; that behavior MUST be tested in a real Electron runtime or an equivalent
runtime-level environment. Verification MUST be designed around the failure mode,
not around a preferred test category.

## Development Guidelines

The principles above govern feature planning, design, implementation, and review.
Project-specific scope gates, tool commands, Electron configuration standards,
test taxonomy, repository paths, and migration details MUST be maintained in the
appropriate project guidance, architecture documents, development documentation,
or CI configuration. Those operational details MUST implement these principles
without turning the Constitution into a runbook.

Plans MUST include a Constitution Check before research and after design. Any
violation MUST be documented with a concrete rationale and a corresponding entry
in Complexity Tracking.

## Governance

This constitution defines the project's durable governing principles. A change to
a principle or mandatory guideline MUST update this document, include a Sync
Impact Report, and explain its compatibility or migration impact. The change MUST
be reviewed with the feature or governance work that motivates it.

Constitution versions use semantic versioning: MAJOR for incompatible governance
or principle removals/redefinitions, MINOR for new principles or materially
expanded mandatory guidance, and PATCH for clarifications and non-semantic edits.
The `Last Amended` date MUST change whenever the constitution changes.

Compliance is reviewed during planning, implementation review, and release
validation. If a conflict exists between this constitution and an older practice,
this constitution takes precedence; the conflict and required migration MUST be
documented rather than resolved implicitly.

**Version**: 3.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date is not recorded | **Last Amended**: 2026-07-11
