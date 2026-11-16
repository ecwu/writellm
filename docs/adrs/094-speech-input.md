# ADR 094: Draft-only speech input

Status: accepted (issue 20, 2026-11-15).

Speech creates an editable Agent composer draft; sending remains an independent user action.
Application-global speech sources store independent names, baseUrl, model, and explicit realtime/file mode.
Each source uses app.sqlite and origin-bound safeStorage credentials, allowing an unauthenticated loopback compatible service.
One global active source is selected only in Settings. The November 16 amendment below replaces the original singleton decision.

Renderer owns microphone capture, a same-origin static AudioWorklet, PCM16 conversion, real
volume feedback, and draft/selection generations. Main owns sender and active project capability
authorization on every operation and completion. Typed endpoints (ADR 088) carry bounded
Uint8Array PCM, never provider credentials. One recognition binds only to its sender and project.

A dedicated PersistentUtilityProcess uses the existing background-worker entrypoint; it accepts
only speech work and prevents synchronous image/LaTeX/citation tasks delaying audio. Each
recognition is one long request with event snapshots and sendToRequest audio/control messages.
No audio, partial text, or speech history is persisted. End, cancellation, revoked capability,
worker failure and timeout release the connection and dedicated process without retry or replay.

The official API probe supports the product budgets of 120 seconds, 100 ms / 4800 byte frames,
24 kHz mono PCM16, 15 second realtime finalization and 60 second file transcription. These are
product limits, not provider guarantees. File mode buffers at most 5.76 MB in worker memory.
Configured HTTP follows loopback-only policy; WSS/loopback WS derives from the same base URL,
retaining proxy prefixes and rejecting redirects. Realtime disables compression and bounds
messages/send backlog. Text is bounded to 64 KiB and partial refresh to 100 ms.

Connection testing is explicit, mutually exclusive with recognition, cancellable and bounded.
Realtime waits for session.updated without audio; file uploads a generated one-second silent WAV.
A successful test establishes protocol acceptance, not microphone access or recognition quality.

Permission request/check handlers share a trusted main-frame/audio-only media rule; existing
clipboard/fullscreen behavior has explicit rules. macOS system permission is checked before
capture and packaged microphone usage/entitlements and static Worklet must be verified.
No project migration or additional process role is needed. Raw audio never enters logs.

The installed OpenAI 7.53.0 WebSocket client forces WSS, including HTTP loopback bases.
Authenticated HTTPS uses that client. Loopback HTTP and connections without credentials use direct ws with the same bounded protocol adapter.
Connections without credentials omit the authorization header. Neither transport reconnects or follows
redirects. Provider incremental deltas normalize to bounded full snapshots; the completed transcript
replaces the preview and must match input_audio_buffer.committed's item ID. The official guide
and installed SDK expose incremental delta text without a revision offset/replacement contract;
no additional correction wire format is assumed.

Alternatives rejected: the shared background instance can block on CPU work; a new provider-specific
worker entrypoint expands packaging without benefit; browser speech APIs bypass endpoint and
credential authority. Multiple sources were originally deferred and are now authorized below. This amends the
existing no-provider-worker decision only by allowing another instance of its existing entrypoint.

Verification covers focused protocol/lifecycle/authorization tests, real Electron binary bridge and
capture interaction, and the complete package gate with microphone/Worklet/worker inventory.
Issue 20 owns delivery; application-local model downloads, file SSE and voice chat remain deferred.
The [official realtime guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
and installed OpenAI 7.53.0 types are the protocol evidence for incremental deltas and final item
correlation; live replacement-offset behavior remains unverified.

## 2026-11-16 Model-specific language hints

The official no-audio connection probe rejects gpt-4o-transcribe when session.update includes languages.
The server returns invalid_parameter for session.audio.input.transcription.languages. The same model accepts the configuration without that optional field.
The default gpt-live-transcribe accepts the language hints. Legacy transcription models omit unsupported hints without changing the saved model or retrying.
Protocol failures retain fixed safe messages and allowlisted error codes across the worker, Main, and Renderer boundaries.
Raw provider messages remain private. This extends compatibility without changing endpoint authority, audio retention, or credential handling.

## 2026-11-16 Multiple sources and model discovery

The user authorizes multiple speech sources and selection only in Settings. Each source keeps its own model and mode.
There is no conversation override. New sources have Main-generated IDs and separate encrypted credentials.
The existing speech row retains its storage identity and becomes the legacy source during a forward app migration.
Its credential binding and ciphertext remain unchanged. Migration uses the existing backup and integrity gates.
The active source becomes an application setting. Missing or removed selection fails closed without fallback.
Recognition snapshots the selected configuration and credential before capture. Later edits affect the next recognition only.
Connection testing can target a saved source without making it active. Cancellation and existing limits remain in force.

Model discovery is explicit and uses the selected source endpoint and credential. Opening Settings does not contact a provider.
A bounded last-successful candidate list survives refresh failure. Endpoint edits invalidate the cache and stale in-flight results.
Candidates contain IDs and display names, not verified transcription capability. Users keep explicit model and mode choices.
Manual model IDs remain supported. Refresh never changes a saved model or active source.
New realtime sources suggest gpt-live-transcribe. New file sources suggest gpt-transcribe. Existing saved models remain unchanged.

The existing Agent catalog is not reused as speech authority because its metadata and filters describe chat models.
The source model endpoint is authoritative for its advertised IDs, but protocol testing remains separate.
The credential never reaches Renderer or a different catalog host. Discovery rejects redirects and bounds time, pages, and bytes.

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

Refresh generations are process-local under the existing application single-instance lock. Durable fingerprints also fence source and credential changes across restarts.
