# Architecture Decision Index

Use this index after reading [the current plan](../current-plan.md) and
[the architecture baseline](../architecture.md). Use the linked ADR for a decision. Use the Phase
file or history log for evidence.

## Current decision groups

- [Security and process boundaries](011-security-boundary-remediation.md), [project history](007-managed-project-version-history.md), [project clone](036-independent-project-clone.md), and [project templates](037-bounded-project-template-catalog.md).
- [Manuscript structure and edits](002-section-tombstones.md), [safe replacement](022-safe-manuscript-wide-replacement.md), [publication](030-xelatex-publication-profile.md), [native Math and Diagram](060-native-block-math-and-application-owned-diagram.md), [comments](079-comment-acceptance-boundaries.md), and [autocomplete](082-deepseek-autocomplete.md).
- [Knowledge and references](034-contained-latex-project-import.md), [citation coverage](047-knowledge-citation-coverage-checks.md), [stable references](070-stable-bibliographic-reference-workflow.md), and [Notebook](062-transient-notebook-read-only-agent.md).
- [Agent runtime and tools](008-pi-provider-catalog-and-agent-model-selection.md), [tool profiles](067-agent-tool-description-layering-and-demand-profiles.md), [interaction modes](068-agent-interaction-mode-ceilings.md), [diagnostics](074-agent-occam-ablation-and-error-propagation.md), [model configuration](076-agent-model-configuration-and-output-completion.md), [message editing](080-agent-message-edit-and-restart.md), [conversation forks](081-conversation-fork.md), [image input](085-agent-image-input.md), and [section write authority](089-section-write-authority.md).
- [Desktop shell](083-tabbed-docking-workbench.md) and [macOS native menu](084-macos-native-menu.md).
- [Dependency refresh](056-dependency-security-and-compatibility-refresh.md) and [this documentation and dependency boundary decision](090-document-navigation-and-dependency-boundaries.md).
- [Engineering maintenance](086-issue-18-engineering-quality.md), [native SQL schema contracts](087-native-sql-and-schema-contract.md), and [typed IPC endpoints](088-typed-ipc-endpoints.md).

Earlier ADRs remain available for historical context. Their current-rule notes and the map below
identify clauses that a later ADR replaced.

## Supersession map

- [ADR 084](084-macos-native-menu.md) replaces only the macOS Menubar clause in [ADR 083](083-tabbed-docking-workbench.md).
- [ADR 060](060-native-block-math-and-application-owned-diagram.md) replaces only display Math in [ADR 057](057-native-inline-math.md).
- [ADR 062](062-transient-notebook-read-only-agent.md) replaces the single-shot Notebook runtime in [ADR 058](058-transient-notebook-knowledge-chat.md). [ADR 083](083-tabbed-docking-workbench.md) later changes Notebook capacity and shared admission.
- [ADR 074](074-agent-occam-ablation-and-error-propagation.md) replaces named recovery, trace, and retry clauses in [ADRs 063](063-agent-compaction-and-tool-loop-recovery.md), [069](069-agent-request-diagnostic-traces.md), [071](071-live-agent-request-retry-and-continuation.md), [072](072-token-pressure-context-compaction-and-manual-command.md), and [073](073-explicit-writing-skill-injection-and-non-blocking-auto-loading.md).
- [ADR 076](076-agent-model-configuration-and-output-completion.md) replaces the manual and custom reasoning exclusion in [ADR 014](014-agent-thinking-level.md).
- [ADR 067](067-agent-tool-description-layering-and-demand-profiles.md), [ADR 074](074-agent-occam-ablation-and-error-propagation.md), and [ADR 077](077-remove-review-fixtures-and-annotations.md) replace separate clauses in [ADR 042](042-agent-tool-contract-reliability-and-scope-discipline.md).
- [ADR 079](079-comment-acceptance-boundaries.md) replaces the quote-only mapping rule in [ADR 078](078-manuscript-comment-threads-and-agent-resolution.md).

Read a later ADR first when an earlier record names it in a `Current rule` note. Keep the earlier
record for the original context and accepted alternatives.

## Dependency boundaries

The architecture keeps these adapters separate because they have different authority and lifecycle
rules:

- Pi Agent Core and Pi AI own interactive Agent sessions and provider-neutral streaming.
- AI SDK Core adapters own embedding and reranking requests.
- Google GenAI and OpenAI adapters serve the fixed image, auxiliary, and probe paths that use them.
- Citation.js and citeproc serve bibliography parsing and formatting.
- JSZip owns DOCX publication. Yauzl owns bounded archive extraction. Yazl is a test fixture writer.

The exact package declarations and lockfile are authoritative. A package-count reduction needs a new
ADR with behavior parity, capability review, migration impact, and focused verification.

## Adding a decision

Create the next numbered ADR. Keep the file path stable after publication. State the context,
decision, alternatives, migration impact, and verification scope. Add a link to this index. Record
delivery state in [current-plan.md](../current-plan.md) only when the task changes that state.
