# ADR 006: Rich Media Blocks And Agent Image Generation

Status: accepted; image-block and asset authority extended by ADR 027/028/029
Date: 2026-07-22

## Context

WriteLLM's accepted editor schema deliberately excluded file blocks, and Agent Harness Protocol v2
limited the model-visible surface to bounded reads and typed manuscript proposals. Rich manuscripts
now require project-local images, Mermaid diagrams, and display mathematics. Agent-authored images
also require one provider call whose cost, cancellation, durable provenance, and manuscript effect
must remain inside the existing trust boundaries.

## Decision

- BlockNote image blocks are admitted only with opaque `writellm-asset:<assetId>` references.
  Mermaid and display mathematics use source-backed custom React blocks. Renderer code never
  receives a reusable filesystem path.
- Immutable asset bytes live under `manuscript/assets/`; project SQLite owns asset identity,
  revision references, hashes, MIME metadata, and Agent/model lineage. Admitted formats are PNG,
  JPEG, and WebP: the image generator emits PNG/JPEG, while uploaded assets may also be WebP.
  Preview URLs are session-bound capabilities served by the existing application protocol.
- The application adds one global `image` provider role implemented by the Google Gemini
  Interactions API through exact-pinned `@google/genai@2.13.0`. The SDK is confined to the existing
  background-worker image gateway; it does not cross into Main, preload, renderer, or Agent tool
  code. The request is request-scoped, cancellable, recorded as a `model_requests` image operation,
  and never becomes a durable job.
- Agent Harness Protocol v3 adds one bounded `generate_image` tool and rich-block insertion to
  `submit_section_change`. The new tool may generate exactly one image and propose exactly one
  insertion. It does not expose a URL, credential, generic network request, file API, or direct
  manuscript mutation.
- Manual mode reviews the prompt, output specification, and placement before generation.
  `section_auto` and `yolo` may automatically approve only a single additive rich-media insertion.
  Generation occurs outside transactions; the editor barrier and exact revision check occur only
  when applying the resulting block.
- Full prompts remain project-local proposal provenance. Logs contain only safe identifiers,
  hashes, lengths, state, and duration.

## Consequences

ADR 005 remains authoritative for capabilities, snapshots, structured tool results, and proposal
semantics, but its exact eleven-tool list is superseded by the bounded twelve-tool Protocol v3
surface. The five Agent persistence tables remain; the project adds manuscript asset/reference
tables and extends existing proposal/model-request enums. No provider-specific worker, generic
network tool, asset BLOB storage, inline math, remote image fetching, or image-editing workflow is
introduced.

## Amendment: Official Gemini SDK Transport

Date: 2026-07-23

Runtime evidence showed that the initial handwritten Interactions REST transport consistently
received HTTP 400 from real Gemini requests. The user approved replacing that transport with
`@google/genai@2.12.0`, using `GoogleGenAI.interactions.create`, so request serialization and response
projection track Google's official client. This is a transport-only revision: the existing
request-scoped cancellation, concurrency-one gateway, no-retry billing policy, safe diagnostics,
asset authority, proposal approval, and Agent capability boundaries remain unchanged.

## Amendment: Fixed Gemini Endpoint And Model Catalog

Date: 2026-07-23

After the SDK transport still received HTTP 400 in field use, the user approved removing the image
provider's endpoint and free-form model configuration. The image settings surface now accepts only
an application-encrypted Gemini API key and one of these fixed model IDs:

- `gemini-3.1-flash-lite-image`
- `gemini-3.1-flash-image`
- `gemini-3-pro-image`
- `gemini-2.5-flash-image`

The background worker constructs `GoogleGenAI` with only the Main-supplied request credential. It
does not accept or pass a base URL, API version, or HTTP option. The connection test uses the same
official client and `models.get`. Current image configuration has no endpoint field; readers accept
only the two historical official endpoint markers and strip them during parsing, so the next save
no longer persists `baseUrl`. This amendment narrows provider authority and does not change Agent,
credential, proposal, asset, or manuscript boundaries.

## Amendment: Correct Interactions Image Contract And MIME Projection

Date: 2026-07-23

Successful field traffic proved the endpoint and credential were valid, but the previous minimal
request let Gemini choose a JPEG and Main then rejected it as PNG-only. The application now
exact-pins `@google/genai@2.13.0` and always sends the documented image response format:

```ts
interactions.create({
  model,
  input: prompt,
  response_format: {
    type: 'image',
    mime_type: 'image/png',
    aspect_ratio,
    image_size
  }
})
```

`aspect_ratio` is omitted for `auto`. `image_size` is sent as the effective size. The
selectable-size `gemini-3.1-flash-image` and `gemini-3-pro-image` models preserve 1K/2K, while the
fixed-1K `gemini-3.1-flash-lite-image` and `gemini-2.5-flash-image` models normalize a requested 2K
to an explicit 1K request. Both requested and effective sizes are recorded in project-local asset
lineage. The SDK request leaves `store` unspecified, retaining the Interactions default `true`.

Gemini may return either PNG or JPEG despite the requested MIME. The worker projects only bounded
base64 plus the actual MIME to Main. Main validates the matching magic and dimensions, atomically
publishes `manuscript/assets/<sha256>.png|.jpg`, records the model/Agent/revision lineage, and writes
only `writellm-asset:<assetId>` into the BlockNote image block. The original SDK error remains the
local logged `cause`; only HTTP status and a bounded uppercase machine code may cross the worker
boundary.

## Amendment: JPEG Request MIME And Preserved Error Cause

Date: 2026-07-23

Live traffic against the real API proved the previous amendment's `mime_type: 'image/png'` wrong:
the Interactions API rejects it with HTTP 400 (`The value 'image/png' is not supported for
'response_format.mime_type'. Supported values: 'image/jpeg'.`). The worker now always requests
`image/jpeg`, the only accepted value; the response-side projection is unchanged and still accepts
either PNG or JPEG after Main validates the actual magic. This is a transport-only correction.

The same incident exposed a diagnostics gap: the pino `err` serializer dropped the non-enumerable
Error `cause`, and worker-boundary causes are strings that `errWithCause` also drops, so the
provider's real 400 message never reached the log. The root logger now serializes errors with
`errWithCause` and re-attaches bounded primitive causes, keeping the original SDK error text (for
example Google's field-level 400 message) in the local log without crossing the worker boundary.
