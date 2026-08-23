# WriteLLM Phase 14 Implementation Plan

Status: Checkpoint 65 is current and incomplete after the completed Checkpoint 66 reprioritization.
Recorded: 2026-08-23

## Checkpoint 65: Native Inline Mathematics

Decision: user-authorized implementation under ADR 057. Introduce BlockNote's native inline Math
only, preserve application-owned display Math and Mermaid, and keep SQLite revision JSON plus the
application publication projection authoritative.

- [~] Add the exact-pinned inline Math spec, bounded editing, slash-menu entry, and layout safety.
- [~] Advance section content to schema v4 with a forward-only current-revision migration.
- [~] Exclude formula source from counts, search, replacement, and readable-citation matching while
  exposing bounded `$...$` notation to Agent reads.
- [~] Map inline Math through Markdown and LaTeX import and Markdown, DOCX, PDF, and LaTeX output.
- [~] Verify contracts, migration integrity, editor behavior, hostile input, and full project gates.

Local evidence will be recorded here after the acceptance gates complete.
