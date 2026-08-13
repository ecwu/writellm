# ADR 029: Image Iteration And Candidate Lineage

Status: Accepted

Date: 2026-08-13

## Context

Checkpoint 43B lets an author ask the ordinary Agent loop for another candidate based on an
existing generated figure. The candidate must keep exact provider, model-request, Agent-run, and
tool-call provenance without making asset bytes mutable or introducing a second conversation or a
special-purpose content-analysis model call. Replacing an image must remain a reviewable manuscript
mutation and must preserve the stable figure identity and author metadata established by
Checkpoint 43A.

The existing `manuscript_assets` row owns immutable content-addressed bytes and generation
metadata, but it cannot express that one independently generated asset is a candidate derived from
another asset. Encoding that relation inside either asset's JSON would make deduplicated candidates
ambiguous and difficult to protect during cleanup.

## Decision

Add a project-local `manuscript_asset_variants` relation. Each row links an immutable parent asset
to an immutable candidate asset and records the generation proposal, the resulting section
proposal, the requested disposition, and creation time. A content-deduplicated candidate may have
more than one lineage row. Both sides use restrictive foreign keys so cleanup cannot erase retained
lineage.

Extend the existing ordinary `generate_image` Agent tool with an optional, block-hash-guarded
iteration target. Main resolves the target image and its generated prompt/specification, combines
that specification with the bounded iteration instruction and current section context, and uses the
existing image provider role and `model_requests` gateway. Source pixels are not sent to the
provider.

Approval is deliberately two-stage:

1. Approving the generation request creates and publishes the immutable candidate asset.
2. Main marks that request superseded by a normal pending `section_patch` proposal. Replacing the
   current figure updates only its asset URL; inserting another candidate creates a new image block.

Rejecting the section proposal keeps the current figure. Approving it uses normal revision,
history, undo, checkpoint, stale-refresh, and asset-reference behavior. The Images workspace shows
bounded parent/candidate lineage and allows visual comparison through existing session-bound asset
preview capabilities.

## Consequences

- No new provider abstraction, model role, conversation, mutable asset format, or pixel-editing
  surface is introduced.
- Replacement preserves `figureId`, caption, alt text, alignment, and preview settings because the
  normal section operation changes only `props.url`.
- Uploaded images cannot be iteration parents because they have no stored generation prompt/spec.
- Candidate bytes remain protected while lineage is retained; deletion and orphan cleanup report
  that protection explicitly.
- Crop, masks, arbitrary image-to-image calls, and source-pixel editing remain deferred.
