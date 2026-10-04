# ADR 085: Agent Image Input

Status: accepted under the user's Issue 3 implementation request
Date: 2026-10-03

## Decision

Persistent Agent conversations accept PNG, JPEG, and static WebP through selection, drop, and paste.
The composer and history use the existing shadcn Attachment component.
Each message accepts four images, with or without text.
Draft imports remain bound to their original conversation across navigation.

Main authorizes each project session, conversation, and attachment reference.
Renderer receives bounded import and preview interfaces, without filesystem paths or general clipboard access.
The background worker uses Photon 0.3.4 to decode and resize images.
Originals retain the existing 20 MiB, 8192-pixel edge, and 40-million-pixel limits.
Sending copies preserve proportions and transparency, without enlargement, within 2000 pixels and 4.5 MiB of Base64.

Migration 0048 adds conversation attachment metadata through the existing backup and integrity gate.
Files live under .writellm/agent-attachments/ with relative paths and content hashes.
Raw message references protect originals and copies, including replaced messages and frozen fork history.
Draft and queue references remain temporary and expire when their owner releases them.
Unreferenced files retain the existing 24-hour cleanup grace period.

History retains the 2 MiB text and metadata limit with a separate 32 MiB image budget.
Pending input also obeys the image budget.
Main rejects unsupported models before message commitment and preserves the draft.
Historical images also require a model with image input.
Token estimates use Pi's image estimate instead of Base64 length.
Recent complete turns retain images during compaction, and summary requests receive selected older images.
Diagnostic traces replace image data with hashes, dimensions, formats, and byte counts.

Notebook, remote URLs, GIF, HEIC, image generation, manuscript insertion, and draft restart recovery remain outside this decision.
Manuscript asset storage conflicts with conversation retention and ownership.
An upload library adds no required capability because Electron and browser events already provide the input routes.

## Verification

Use focused Electron tests for migration, storage, ownership, runtime input, queue lifetime, history, editing, forks, and compaction.
Use real Electron scenarios for all input routes and desktop controls.
Run one full package gate to make sure that Photon WASM loads and processes images in the packaged application.
Record platform results and remaining limits in the current plan and implementation history.

## Sources

[Issue 3](https://github.com/ecwu/writellm/issues/3) defines the authorized scope and acceptance criteria.
[shadcn Attachment](https://ui.shadcn.com/docs/components/attachment) provides image media, actions, and processing states for conversation attachments.
The existing generated Radix component supplies the UI primitive without another upload dependency.
