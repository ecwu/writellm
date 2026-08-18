# ADR 051: Fixed Multi-Provider Image Catalog

Status: accepted for Checkpoint 57; implementation authorized
Date: 2026-08-18

## Context

ADR 006 introduced one application-global `image` role backed only by Google Gemini. Field use has
shown that image generation must remain available when one provider is unavailable, but implicit
retry, fallback, or provider rotation would make billing and provenance ambiguous. OpenAI and xAI
both expose suitable single-image generation APIs through the official OpenAI Node SDK, while the
existing Agent tool, background-worker, model-request, asset, proposal, and lineage boundaries
already own the rest of the workflow.

## Decision

Checkpoint 57 replaces only ADR 006's Gemini-exclusive provider choice with a fixed catalog:
Google Gemini, OpenAI, and xAI. Their configuration and encrypted credentials are independent and
may coexist, but exactly zero or one saved source is explicitly active. Generation uses only the
active source captured when the request starts. There is no automatic fallback, rotation, retry,
or failure-triggered provider switch.

The catalog and endpoints are closed:

- `google-gemini` retains the four accepted Gemini image models and the exact-pinned Google SDK.
- `openai` accepts only `gpt-image-2` at OpenAI's official endpoint and uses exact-pinned
  `openai@7.5.0` with the Image API.
- `xai` accepts only `grok-imagine-image-2.0` at `https://api.x.ai/v1` through the same OpenAI SDK.

No image source accepts a configurable endpoint. OpenAI uses one `images.generate` request with
`n: 1`, `quality: "auto"`, and PNG output. xAI requests base64 directly, passes the approved aspect
ratio and 1K/2K resolution, and does not follow provider-hosted image URLs. SDK retries are disabled;
the existing request timeout and cancellation signal remain authoritative. Connection tests use a
non-generating model lookup and therefore do not prove generation quota, organization verification,
or content-policy acceptance.

The three configurations remain application-global in `app.sqlite` under provider IDs scoped as
`image:<providerId>`, and credentials remain separately bound safeStorage ciphertext. One app
setting stores the active source. Migration moves the legacy `image` Gemini row and credential to
`image:google-gemini`, clears its binding fingerprint for the existing startup backfill, and makes
Gemini active. Removing the active source clears the selection and generation fails closed.

OpenAI automatic canvas selection intentionally returns a nullable effective image-size intent:
the requested 1K/2K value remains in lineage, while Main continues to validate and record the
actual returned dimensions, MIME, hash, and bytes. Historical model requests and asset lineage are
read without rewriting provider or model strings.

## Consequences

The existing `generate_image` tool contract, approval flow, worker role, model-request authority,
asset publication, and candidate lineage remain unchanged. Renderer settings gain three fixed
source workspaces and one explicit active-source control, while credentials, prompts, response
bytes, private paths, and moderation details remain outside snapshots and ordinary logs.

This decision does not introduce Responses API image generation, image editing, reference images,
masks, transparent output, multi-image batches, 4K, proxy endpoints, arbitrary third-party
providers, a generic image plugin framework, or provider-specific workers.

## Alternatives Rejected

- Automatic fallback or round-robin routing: a failed call may already be billable, so hidden
  retries can duplicate cost and obscure lineage.
- Responses API for OpenAI: the current operation is a single prompt producing a single image, for
  which the Image API is the narrower interface.
- Provider-hosted xAI URLs: following temporary URLs would add another untrusted network
  capability and redirect boundary where base64 output is available.
- A generic provider plugin contract or configurable endpoint: this expands credential and network
  authority beyond the three reviewed transports without a current product requirement.
