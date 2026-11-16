# ADR 093: Configurable Image Source Instances And Models

Status: accepted; implementation authorized
Date: 2026-10-30

## Context

ADRs 051 and 052 fixed the image catalog to four singleton sources with closed model lists and no
configurable endpoint. Field use needs the Agent-provider experience instead: several accounts of
the same transport, OpenAI-compatible proxies and gateways, newly released image model IDs, and a
different image model for a specific conversation. The user explicitly authorizes multiple source
instances, a custom endpoint for OpenAI-compatible transports, built-in plus manual models, a global
default with a per-conversation override, and migration of existing image configuration.

## Decision

The image catalog becomes a user-managed list of source instances. Each instance has a stable
Main-generated `sourceId`, a display name, and one of the four reviewed transports:
`google-gemini`, `google-vertex`, `openai` (OpenAI Image API), and `xai`. No new transport, SDK, or
worker role is introduced.

- Each instance is one `provider_configs` row with ID `image:<sourceId>`. API-key transports keep
  separately bound safeStorage ciphertext; Vertex keeps local ADC and stores no credential.
- `openai` and `xai` instances accept an optional HTTP(S) Base URL under the existing provider URL
  rules. Absence means the official endpoint. The credential binding already covers the endpoint
  origin, so changing the endpoint clears the stored key. Gemini and Vertex endpoints stay fixed.
- Each transport contributes its previously accepted built-in models. An instance can add manual
  model IDs with display names and declared supported sizes (1K, or 1K and 2K), and can disable any
  model. Manual metadata never carries credentials.
- One app setting stores the global default `{ sourceId, modelId }`. Each Agent conversation can
  store an override in `agent_sessions`; null uses the global default.
- Main resolves the selection when image generation starts, after approval, and validates that the
  source exists, is authenticated, and the model is enabled. A missing or invalid selection fails
  closed. Generation never falls back, rotates, or retries through another source or model.
- The worker receives one bounded runtime configuration: transport, model, optional endpoint,
  supported sizes, and existing timeout and output defaults. Model requests continue to record the
  transport as `provider_id` and the model ID. Fingerprints add the endpoint only when one is set,
  so official-endpoint history is unchanged.

App migration 0011 rewrites each existing `image:<transport>` row in place as an instance whose
`sourceId` is the legacy transport ID, keeping its credential row and binding identity. The active
source and its configured model become the global default. Project migration 0049 adds the nullable
conversation override columns. Historical model requests, lineage, and conversations are not
rewritten.

## Consequences

Settings gains an Agent-style source list with add, rename, endpoint, credential, model, and default
controls. Agent details gains an image model selector for the current conversation. The
`generate_image` tool contract, approval flow, asset publication, and lineage remain unchanged.

A custom endpoint receives the instance's API key and prompts. This is the same authority the user
already grants Agent custom presets. Connection tests remain non-generating and do not prove image
quota or content-policy acceptance. Manual model sizes are user declarations; Main still validates
returned bytes, MIME, and dimensions.

This decision supersedes only ADR 051's fixed singleton catalog, closed model lists, and
no-endpoint rule, and ADR 052's fixed Vertex model list for manual additions. Their
no-fallback, base64-only, retry-free, and ADC rules remain in force.

## Alternatives Rejected

- Keep four singleton sources and only open the model ID: this does not support several accounts
  or proxies.
- A generic image plugin or arbitrary transport: each transport still needs a reviewed request and
  response adapter.
- Per-project instead of per-conversation override: image generation runs inside Agent
  conversations, which already own their Agent model selection.
- Fallback to the global default when an override is invalid: this would hide billing and
  provenance changes.

## 2026-11-16 Explicit model discovery

The user authorizes discovery of current model IDs from configured sources. Existing built-in models remain compatibility seeds.
OpenAI-compatible sources use their models endpoint. Official xAI uses its image-generation-models endpoint.
Gemini uses its paginated models endpoint. Vertex can use matched public metadata under the amendment below without querying project resources.
Discovery returns bounded candidates and retains the last successful list after refresh failure. It never changes a selection.
Users adopt an image candidate through the existing manual model form and declare supported sizes.
General model lists do not establish image output, supported dimensions, quota, or generation success.
Endpoints and credentials stay bound to their source. Redirects and unbounded catalog responses remain prohibited.

Official references: [OpenAI models](https://developers.openai.com/api/reference/resources/models/methods/list),
[Gemini models](https://aistudio.google.com/api-reference/models),
[xAI models](https://docs.x.ai/developers/rest-api-reference/inference/models), and
[Vertex publisher models](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/publishers.models/list).

## 2026-11-16 Public catalog metadata

The user rejects a required testing step for ordinary model selection. Connection tests remain optional diagnostics, never activation gates.
Model discovery combines source-advertised IDs with public models.dev v2 metadata. No new SDK dependency is required.
The public requests use fixed URLs without provider credentials, custom endpoint details, or project content.
The filtered experimental v2 directory supplies task types and API names such as images, transcriptions, and realtime.
Known task and endpoint metadata organize model choices. Unknown source IDs remain selectable and manual IDs remain available.
A missing public catalog entry never removes a newer source-advertised model. Discovery never changes a saved selection.
Public fallback lists apply only to matched provider identities and unsupported model-list routes, not authentication failures.
Public metadata is cached and bounded. Metadata failure does not discard a successful source list.
Catalog metadata does not grant account access or change the reviewed transport adapter. Image sizes remain explicit when metadata omits them.
Source: [models.dev v2 directory](https://models.dev/experimental/v2.0/api.json?type=image,transcription).
The experimental response uses a narrow validated projection. Schema changes cannot replace saved settings or reroute requests.
LiteLLM public metadata was researched as an alternative. It is not an additional runtime catalog dependency.
