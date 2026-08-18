# ADR 048: Existing Image Cross-Section Relocation

Status: accepted for Checkpoint 53
Date: 2026-08-18

## Context

Hands-on Agent use attempted to move an existing SPACE taxonomy image from the Background root
section into a child section. `submit_section_change.moveBlocks` correctly rejected the source
block because every ordinary section patch resolves all targets and anchors inside its one target
section. The generic conflict recovery then incorrectly suggested refreshing the target section,
even though no revision or hash had changed and a refresh could never make the source block belong
to the destination section.

The existing image-generation tool is not an appropriate workaround. Relocation must reuse the
registered immutable asset and existing figure metadata without invoking a provider, allowing the
model to invent an asset URL, or introducing a multi-section mutation authority.

## Decision

Checkpoint 53 adds one model-facing operation, `insertExistingImage`, inside the existing
`submit_section_change` tool. The operation names one source section and copies one exact
`read_section` block precondition plus the ordinary destination anchor and placement. Main requires
that the source and destination sections differ, that the source block was read in the current run,
that its current authoritative block and hash still match, and that it is an image backed by an
active manuscript asset. A source image with an active project-local annotation or unresolved
section-scoped review anchor is rejected.

Main copies the authoritative image rather than accepting model-authored block JSON or an asset
ID. It mints a new destination block ID, preserves the active asset URL and image presentation
metadata, and preserves the stable `figureId`. The model-only operation normalizes to the existing
single-section `insertBlocks` domain operation. The persisted proposal kind, simulator, revision
CAS, preview, approval, Undo, materialization, and asset-reference authority remain unchanged.

Cross-section relocation is deliberately two-stage and non-atomic. The Agent first proposes the
destination insertion. It may propose removal of the original source block only after the
insertion result is `applied` or `satisfied`, using the original source block ID and hash. A pending,
failed, conflicted, or rejected insertion never authorizes source removal. A source-removal
conflict is terminal for the relocation attempt: the Agent does not refresh the hash and delete a
newer source block. This failure bias may leave a recoverable duplicate but never removes the only
copy.

Same-section movement continues to use `moveBlocks`. When an ordinary target belongs to another
section, Main reports an argument error directing the Agent to `insertExistingImage` instead of a
refreshable missing-block conflict. Ordinary missing, deleted, and stale same-section targets keep
their existing conflict behavior.

Application policy, not a new workflow table or coordinator, owns the cross-tool sequence. Manual
mode stops on the pending insertion and waits for review. Write Auto and YOLO may continue only
after the ordinary insertion proposal has actually applied. The feature adds structured safe-ID
lifecycle logs at insertion preparation and retains the existing proposal/application logs.

## Consequences

The registered model-visible tool count remains twenty. No database migration, new proposal kind,
IPC method, worker role, provider call, dependency, Renderer authority, generic block-copy surface,
or cross-section transaction is added. Existing-image relocation remains subject to ordinary
proposal review and exact section revision checks.

The first version covers one image block per operation. Text, tables, Mermaid, math, nested block
subtrees, blocks with active annotations, and generic asset-workspace insertion remain unsupported.
If a future product requirement needs atomic multi-section moves or external-anchor migration, it
requires a separate architecture decision and persistence design.

This narrowly amends ADR 042: fabricated and implicit cross-section block references remain
rejected, while `insertExistingImage` is the one explicit Main-authoritative source-copy exception.

## Alternatives Rejected

- Extend `moveBlocks` with a source section. That changes a single-section domain operation into a
  two-revision authority and expands preview, apply, Undo, materialization, and recovery semantics.
- Let the model submit an image block or asset URL. That permits fabricated or unavailable asset
  references and needlessly sends canonical image payloads through the model.
- Generate a replacement image. It changes immutable bytes and lineage rather than relocating the
  user's existing figure.
- Delete first and insert second. A failed insertion could remove the only current copy.
- Persist a relocation coordinator. Current evidence needs one safe two-stage Agent workflow, not
  a new durable state machine.
