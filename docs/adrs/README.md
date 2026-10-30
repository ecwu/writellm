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
- [Dependency refresh](056-dependency-security-and-compatibility-refresh.md), [this documentation and dependency boundary decision](090-document-navigation-and-dependency-boundaries.md), and [the documentation evidence archive](092-documentation-evidence-archive.md).
- [Engineering maintenance](086-issue-18-engineering-quality.md), [native SQL schema contracts](087-native-sql-and-schema-contract.md), [typed IPC endpoints](088-typed-ipc-endpoints.md), and [single endpoint authority and compatibility repairs](091-issue-19-endpoint-authority-and-compatibility.md).

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
- [ADR 091](091-issue-19-endpoint-authority-and-compatibility.md) replaces the migration-batch wrapper, preserved per-handler session assertions, and synchronous rejection clauses in [ADR 088](088-typed-ipc-endpoints.md). It also adds canonical JSON compatibility profiles and stricter error-handling guard rules to [ADR 086](086-issue-18-engineering-quality.md).
- [ADR 092](092-documentation-evidence-archive.md) amends the append-only history rule for one summary pass and archives verification evidence at a pinned commit.

Read a later ADR first when an earlier record names it in a `Current rule` note. Keep the earlier
record for the original context and accepted alternatives.

## All decisions

Status values:
- **Current**: the whole decision applies.
- **Partly replaced**: read the named later ADR first. The rest still applies.
- **Replaced**: kept only for history.

No ADR 045 exists.

| ADR | Decision | Status |
| --- | --- | --- |
| [001](001-cp19.5-boundaries.md) | Freeze the Checkpoint 19.5 boundaries: seven durable job types, three worker roles, and the Agent tool and table set. | Partly replaced by 005, 024, and 025 (tool list and tables). |
| [002](002-section-tombstones.md) | Deleting a section leaves an internal tombstone. Its revision and proposal lineage stay, and its ID is never reused. | Current |
| [003](003-section-proposal-refresh.md) | Never apply a stale section proposal. A three-way check creates a new pending replacement or reports a conflict. | Current |
| [004](004-agent-approval-policy-and-model-limits.md) | Agent approval modes (`manual`, `section_auto`, `yolo`) and model limits. | Partly replaced by 005, 008, 043, and 044. |
| [005](005-agent-harness-protocol-v2.md) | Agent Harness Protocol v2: bounded read tools, typed submit tools, and no generic authority. | Partly replaced; the protocol advanced in 006, 013, 024, 025, and later. |
| [006](006-rich-media-and-image-generation.md) | Asset-referenced image blocks, source-backed Mermaid and Math, and the Agent `generate_image` tool. | Partly replaced; extended by 027–029 and 060. |
| [007](007-managed-project-version-history.md) | Linear checkpoint history in an application-owned bare Git repository at `.writellm/history.git`. | Current |
| [008](008-pi-provider-catalog-and-agent-model-selection.md) | Application-global Pi provider catalog, plus per-conversation model selection with run snapshots. | Current; 076 governs model configuration. |
| [009](009-settings-workspace-and-agent-model-availability.md) | Settings as one Command workspace with provider sections and Agent model availability. | Current |
| [010](010-background-index-readiness-and-knowledge-summaries.md) | The project opens before the rebuildable index finishes. Search reports preparing or unavailable meanwhile. | Current |
| [011](011-security-boundary-remediation.md) | `ProjectFilesystem` capability, safe database preflight, credential binding, and bounded projections. | Current |
| [012](012-agent-provider-request-lifetime.md) | No wall-clock deadline for Agent generation, and at most five attempts before content is streamed. | Current |
| [013](013-downloadable-agent-writing-skills.md) | Main-installed, hash-verified, read-only Writing Skills from GitHub pins. | Partly replaced by 053, 054, 073, and 074 (selection and loading). |
| [014](014-agent-thinking-level.md) | A per-conversation Pi Thinking level, clamped to supported values and snapshotted per run. | Partly replaced by 062 and 076. |
| [015](015-agent-flow-polish-and-review-continuation.md) | One continuous Agent conversation canvas and continuation after review. | Partly replaced by 016, 038, and 065. |
| [016](016-agent-progress-visibility-and-quick-controls.md) | Agent progress visibility and compact composer controls. | Partly replaced by 038 (composer controls). |
| [017](017-agent-prompt-architecture.md) | Application-owned prompt layers, ordering, and escaped dynamic blocks. | Partly replaced by 073 and 074 (Skill preparation). |
| [018](018-multi-conversation-agent-concurrency.md) | Independent concurrent Agent conversations with one run each. | Partly replaced by 019 and 083 (admission limit). |
| [019](019-rolling-context-checkpoints-and-safe-recovery.md) | Rolling context checkpoints and safe recovery. | Partly replaced by 049, 064, 072, 074, and 083. |
| [020](020-configurable-citation-presentation.md) | Citation presentation (full, numbered, icon) without changing stored text, plus citation-aware counting and export. | Current; 070 adds formatted CSL mode. |
| [021](021-manuscript-find-and-offset-source-map.md) | Manuscript-wide literal Find with exact offset source maps. | Current |
| [022](022-safe-manuscript-wide-replacement.md) | Safe manuscript-wide Replace with an exhaustive preview, one-transaction apply, and per-section Undo. | Current |
| [023](023-selection-based-quick-ai-actions.md) | Seven fixed selection quick actions through the ordinary Agent conversation. | Current |
| [024](024-agent-native-review-fixtures.md) | Agent-native review fixtures and Writing Rules. | Partly replaced by 025 and 077; only Writing Rules remain. |
| [025](025-agent-writing-task-identity-and-plan.md) | One bounded Writing Task per conversation, with Main-allocated IDs and monotonic versions. | Current |
| [026](026-agent-change-set-batch-sequencing.md) | Sequenced batch decisions over individual task proposals, with a durable recovery cursor. | Partly replaced by 077 (Review Issue paths). |
| [027](027-figure-semantics-and-schema-v3.md) | Stable figure identity, caption, and alt text (section schema v3). | Current |
| [028](028-manuscript-asset-workspace-and-safe-deletion.md) | Asset workspace and protected two-phase asset deletion. | Current |
| [029](029-image-iteration-candidate-lineage.md) | Image iteration through immutable candidate lineage and ordinary section proposals. | Current |
| [030](030-xelatex-publication-profile.md) | One application-owned XeLaTeX/ctexart publication profile, with no compiler execution. | Partly replaced by 070 (bibliography output). |
| [031](031-main-owned-chromium-pdf-publication.md) | PDF publication through one sandboxed hidden Chromium window per export. | Current |
| [032](032-session-bound-manuscript-import-staging.md) | Main-owned, session-bound import plans, with no revision change until apply. | Current |
| [033](033-isolated-inert-latex-import.md) | Single-file LaTeX import in a disposable, network-free parser process. | Current |
| [034](034-contained-latex-project-import.md) | Contained LaTeX directory and archive import with no TeX execution. | Current |
| [035](035-project-local-manuscript-annotations.md) | Project-local manuscript annotations and TODOs. | Replaced by 077; Comments are 078–079. |
| [036](036-independent-project-clone.md) | Clone / Save As as a separate identity boundary with a new `projectId`. | Current |
| [037](037-bounded-project-template-catalog.md) | Strict, versioned project templates limited to Brief, outline, and Writing Rules data. | Current |
| [038](038-agent-composer-progressive-disclosure.md) | Composer with four action groups and a shared Add and slash catalog. | Current |
| [039](039-agent-approval-shorthand-and-responsive-composer.md) | Approval shorthand labels and desktop composer sizing. | Partly replaced by 043 (`Section` shorthand). |
| [040](040-agent-composer-circular-send-action.md) | Icon-only circular Send action. | Current |
| [041](041-agent-pending-follow-up-queue.md) | Main-owned pending Follow-up queue with a persist-before-provider barrier. | Current |
| [042](042-agent-tool-contract-reliability-and-scope-discipline.md) | Compact preflight schemas with Main-authoritative invariants. | Partly replaced by 067, 074, and 077. |
| [043](043-write-auto-and-yolo-approval-semantics.md) | Write Auto and YOLO approval semantics. | Partly replaced by 044 (run snapshot). |
| [044](044-live-approval-mode-reads-at-proposal-time.md) | Approval mode is read live when a proposal is created. | Current |
| [046](046-pi-active-tool-loop-context-recovery.md) | Context recovery inside an active Pi tool loop. | Partly replaced by 074 (one-recovery limit). |
| [047](047-knowledge-citation-coverage-checks.md) | Read-only Knowledge citation coverage derived from current revisions and the active index. | Current |
| [048](048-existing-image-cross-section-relocation.md) | Copy an existing image across sections, then remove it only after the insertion applies. | Current |
| [049](049-harness-style-writing-context-compaction.md) | Writing-specific compaction handoff. | Partly replaced by 064, 072, and 074. |
| [050](050-agent-composer-context-usage-indicator.md) | Context-usage indicator shown only for usage matching the current model. | Current |
| [051](051-fixed-multi-provider-image-catalog.md) | Fixed Gemini, OpenAI, and xAI image catalog with one explicit active source and no fallback. | Amended by 093 |
| [052](052-google-vertex-ai-nano-banana-image-source.md) | Google Vertex AI image source using local ADC. | Amended by 093 |
| [053](053-composable-progressive-writing-skills.md) | Composable, progressive Writing Skills. | Partly replaced by 054, 073, and 074. |
| [054](054-observable-per-run-writing-skill-loading.md) | Writing Skills load per run through visible tool reads. | Partly replaced by 073 and 074. |
| [055](055-textual-writing-skill-mentions.md) | `$skill-name` mentions as ordinary prompt text. | Partly replaced by 073 and 074. |
| [056](056-dependency-security-and-compatibility-refresh.md) | Dependency maintenance boundaries, with dated amendments for each approved batch. | Current |
| [057](057-native-inline-math.md) | Native BlockNote inline Math (schema v4). | Partly replaced by 060 (display Math). |
| [058](058-transient-notebook-knowledge-chat.md) | Transient Notebook over selected Knowledge sources, never persisted. | Partly replaced by 062 and 083; source-capacity amendment applies. |
| [059](059-first-run-onboarding.md) | Optional, versioned first-run provider and project onboarding. | Current |
| [060](060-native-block-math-and-application-owned-diagram.md) | Native `mathBlock` and application-owned Diagram (schema v5). | Current |
| [061](061-agent-user-clarification-tool.md) | `ask_user` clarification with Main-owned in-run waiting. | Current |
| [062](062-transient-notebook-read-only-agent.md) | Notebook as a transient read-only Pi Agent over selected sources. | Current |
| [063](063-agent-compaction-and-tool-loop-recovery.md) | Complete-run compaction scanning and tool-loop finalization. | Partly replaced by 074. |
| [064](064-writing-harness-semantic-compaction.md) | Semantic compaction that discards re-readable tool bodies. | Partly replaced by 074. |
| [065](065-agent-sidebar-focus-hierarchy.md) | Four-region Agent sidebar hierarchy. | Current |
| [066](066-agent-table-authoring-and-publication.md) | Hash-bound table reads and edits, and portable table publication. | Current |
| [067](067-agent-tool-description-layering-and-demand-profiles.md) | Layered tool descriptions, run-local capability groups, and envelope budgets. | Current |
| [068](068-agent-interaction-mode-ceilings.md) | Ask, Plan, and Write interaction ceilings snapshotted per run. | Current; 077–079 adjust the tool set. |
| [069](069-agent-request-diagnostic-traces.md) | Content-addressed, project-local diagnostic request traces. | Partly replaced by 074 (best-effort capture). |
| [070](070-stable-bibliographic-reference-workflow.md) | Stable project References, one selected Zotero bibliography file, and CSL formatting. | Current |
| [071](071-live-agent-request-retry-and-continuation.md) | Live retry and continuation of a failed provider request. | Replaced by 074; a new message starts an ordinary run. |
| [072](072-token-pressure-context-compaction-and-manual-command.md) | Token-pressure compaction and the manual `/compact` command. | Partly replaced by 074; `/compact` remains. |
| [073](073-explicit-writing-skill-injection-and-non-blocking-auto-loading.md) | Explicit Skill injection and non-blocking automatic loading. | Partly replaced by 074. |
| [074](074-agent-occam-ablation-and-error-propagation.md) | Remove redundant Agent execution policy and propagate concrete safe diagnostics. | Partly replaced by 083 (admission cap). |
| [075](075-agent-panel-presentation.md) | One typed Renderer projection for Agent panel content. | Current |
| [076](076-agent-model-configuration-and-output-completion.md) | One current catalog resolution per run, and `length` treated as incomplete output. | Current |
| [077](077-remove-review-fixtures-and-annotations.md) | Remove Review Center, Review Issues, and manuscript annotations. | Current |
| [078](078-manuscript-comment-threads-and-agent-resolution.md) | Manuscript comment threads with delegated Agent resolution. | Partly replaced by 079. |
| [079](079-comment-acceptance-boundaries.md) | Canonical comment anchor mapping and resolution evidence requirements. | Current |
| [080](080-agent-message-edit-and-restart.md) | Copy messages and edit/restart the latest message without deleting raw history. | Current |
| [081](081-conversation-fork.md) | Conversation forks with frozen references to an effective event prefix. | Current |
| [082](082-deepseek-autocomplete.md) | Ephemeral DeepSeek editor autocomplete. | Current; its in-file amendments apply. |
| [083](083-tabbed-docking-workbench.md) | Dockview workbench, independent Notebooks, and a three-run shared admission limit. | Partly replaced by 084 (macOS menu). |
| [084](084-macos-native-menu.md) | Native application menu on macOS; shadcn Menubar elsewhere. | Current |
| [085](085-agent-image-input.md) | Persistent Agent conversation image input. | Current |
| [086](086-issue-18-engineering-quality.md) | Engineering quality boundaries for shared helpers and error handling. | Current; 091 extends the guard and canonical JSON. |
| [087](087-native-sql-and-schema-contract.md) | Prepared SQL as the primary database implementation, plus a schema contract test. | Current |
| [088](088-typed-ipc-endpoints.md) | Shared typed IPC endpoint definitions. | Partly replaced by 091 (registration authority). |
| [089](089-section-write-authority.md) | Shared `SectionRepository` for manuscript and Agent section writes. | Current |
| [090](090-document-navigation-and-dependency-boundaries.md) | Documentation navigation and retained library boundaries. | Current |
| [091](091-issue-19-endpoint-authority-and-compatibility.md) | Endpoint registration as the single IPC authority, and canonical JSON compatibility. | Current |
| [092](092-documentation-evidence-archive.md) | Summarize verification evidence and archive it at a pinned commit. | Current |
| [093](093-configurable-image-source-instances-and-models.md) | Multiple image source instances, OpenAI-compatible endpoints, manual image models, and a per-conversation override. | Current |

## Dependency boundaries

The architecture keeps these adapters separate because they have different authority and lifecycle
rules:

- Pi Agent Core and Pi AI own interactive Agent sessions and provider-neutral streaming.
- AI SDK Core adapters own embedding and reranking requests.
- Google GenAI and OpenAI adapters serve the image, auxiliary, and probe paths that use them.
- Citation.js and citeproc serve bibliography parsing and formatting.
- JSZip owns DOCX publication. Yauzl owns bounded archive extraction. Yazl is a test fixture writer.

The exact package declarations and lockfile are authoritative. A package-count reduction needs a new
ADR with behavior parity, capability review, migration impact, and focused verification.

## Adding a decision

Create the next numbered ADR. Keep the file path stable after publication. State the context,
decision, alternatives, migration impact, and verification scope. Add a row to the decision table
and update the status of any ADR it replaces. Record
delivery state in [current-plan.md](../current-plan.md) only when the task changes that state.
