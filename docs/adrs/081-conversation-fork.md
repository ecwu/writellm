# ADR 081: Conversation Fork

Status: accepted under the author's explicit implementation request
Date: 2026-09-08

## Decision

Fork only at a persisted complete assistant reply whose run has settled. Create an independent
conversation with inherited model, thinking, interaction and approval settings and an empty draft.
Creation is transactional and request-idempotent, without provider preparation or model calls.
The source may continue subsequent work or be archived. All conversations share current project
content; no manuscript snapshot, conversation merge or Notebook persistence is introduced.

Migration 0047 records fork provenance and flattened immutable event references. Each reference
has its own display identity and preserves the source logical sequence. New local events start
after the inherited boundary. Parent replacement intervals cannot alter a committed child prefix.
A separate conversation-history view combines frozen references and local effective events for
presentation, model history, title generation and compaction. The existing effective-events view
remains the local execution/edit authority. This avoids duplicating payloads, runs and usage, and
avoids recursive parent reads or parent edits changing children. Foreign keys retain referenced
raw evidence. Forks may fork again. Inherited messages are read-only.

Do not inherit compaction events: reconstruct from the frozen raw prefix and compact on demand.
Historical tool records carry no approvals, task, delegation, retry or execution authority.
Read current manuscript/context on the next run and explicitly mark inherited history as memory.
Keep source usage on source runs. Do not create automatic titles until a user sends new work.

The existing shadcn message actions expose fork, with a boundary marker and source navigation.
Navigation can inspect archived sources without restoring them; replaced source messages are
reported as unavailable. Errors preserve drafts and creation requests can be retried safely.

## Verification

Use migration backup/integrity/rollback coverage, focused Electron-hosted history, IPC, editing
and compaction tests, and real Electron fork/navigation/reopen scenarios. No dependency, provider
API, worker protocol, package or release changes are required. Delivery evidence belongs in the
current plan and append-only implementation history.
