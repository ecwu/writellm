# WriteLLM Phase 14 Implementation Plan

Status: Checkpoint 65 is complete.
Recorded: 2026-08-23

## Checkpoint 65: Native Inline Mathematics

Decision: user-authorized implementation under ADR 057. Introduce BlockNote's native inline Math
only, preserve application-owned display Math and Mermaid, and keep SQLite revision JSON plus the
application publication projection authoritative.

- [x] Add the exact-pinned inline Math spec, bounded editing, slash-menu entry, and layout safety.
- [x] Advance section content to schema v4 with a forward-only current-revision migration.
- [x] Exclude formula source from counts, search, replacement, and readable-citation matching while
  exposing bounded `$...$` notation to Agent reads.
- [x] Map inline Math through Markdown and LaTeX import and Markdown, DOCX, PDF, and LaTeX output.
- [x] Verify contracts, migration integrity, editor behavior, hostile input, and full project gates.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-14.md#checkpoint-65-native-inline-mathematics).
