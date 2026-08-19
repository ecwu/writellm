# ADR 052: Google Vertex AI Nano Banana Image Source

Status: accepted for Checkpoint 59; implementation authorized
Date: 2026-08-19

## Context

ADR 051 established an explicit Google Gemini, OpenAI, and xAI image catalog. Google AI Studio and
Google Cloud Vertex AI have distinct billing, credential, and endpoint identities even when they
expose the same Gemini Image model family. Treating them as one source would make configuration,
cost, failure, and model-request lineage ambiguous.

The accepted product flow uses the user's local Google Cloud Application Default Credentials (ADC),
normally established with `gcloud auth application-default login`. WriteLLM stores only the Project
ID and fixed model settings; it neither imports nor persists Google credentials. The exact-pinned
`@google/genai@2.13.0` Node client discovers ADC when initialized for Vertex with `project` and
`location` and no API key.

## Decision

Checkpoint 59 adds `google-vertex` as the fourth fixed image source alongside `google-gemini`,
`openai`, and `xai`. All configurations and authentication identities remain independent; zero or one
source is explicitly active, and requests never fall back, rotate, or retry through another source.

Vertex configuration accepts one validated Google Cloud Project ID, fixed `global` location, and
one of three fixed Gemini Image models:

- Nano Banana: `gemini-2.5-flash-image`;
- Nano Banana Pro: `gemini-3-pro-image`;
- Nano Banana 2: `gemini-3.1-flash-image`.

The source uses the official SDK's fixed global Vertex client, which resolves the
`aiplatform.googleapis.com` project path and ADC bearer authorization. No API key, custom endpoint,
location, model ID, URL-returning image flow, or credential-controlled destination is accepted.
Generation requests one text-and-image candidate and one bounded inline PNG/JPEG image. The
existing timeout and cancellation signal remain authoritative, and there is exactly one model
request without application-level retry.

No credential row is stored under `image:google-vertex`; saving that source also clears any stale
credential row at that ID. ADC discovery and token exchange stay inside the background worker, and
Renderer snapshots expose only the Project ID and non-secret settings. Main continues to own source
capture, model-request lineage, image magic/dimension/hash validation, immutable asset publication,
and the typed insertion/iteration proposal. Existing Google Gemini configuration, ciphertext,
activation, and historical lineage are not migrated or rewritten.

## Consequences

The image catalog becomes a fixed four-source directory without a database schema migration. The
settings workspace gains Project ID, fixed location, model, and explicit local-ADC guidance for
Vertex. Connection tests perform a non-generating `countTokens` request and do not prove image
quota, billing, or content-policy acceptance.

Users must establish local ADC for an identity with access to the selected project and appropriate
Vertex AI permissions such as `roles/aiplatform.user`. AI Studio keys, Google Cloud API keys,
Express Mode keys, and service-account JSON import into WriteLLM are outside this checkpoint.

## Alternatives Rejected

- Replace Google Gemini with Vertex: this would destroy an independent working credential and make
  rollback and historical configuration ambiguous.
- Vertex Express Mode: it omits the requested Project ID identity and has different billing and
  endpoint semantics.
- Persist an authorization key or service-account JSON: both widen WriteLLM's secret authority and
  duplicate the user's existing Google Cloud login lifecycle.
- Build a custom OAuth login: local ADC already supplies the requested developer-machine identity
  without adding a token UI or refresh-token store to the application.
