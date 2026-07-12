# Writing Orientation Storage Contract

Logical path: `workspace/writing-orientation.json` under the validated active project root. Only main resolves the absolute path.

- Missing file loads a canonical empty document at revision 0 without writing.
- Save validates the entire snapshot, active `projectId`, `baseRevision` and 2 MiB ceiling.
- Saves are serialized per project. The repository writes canonical UTF-8 JSON to a unique sibling temp file, flushes/closes it, then renames over the target.
- Revision increments exactly once for a transaction that completes the canonical replacement and the structured Git commit required by accepted ADR-001. `updatedAt` and durable IDs are main-generated.
- A completed `mutationId` is bound to the active project session, method, and exact validated payload. Repeating that request returns its prior result and does not write again; reuse with a different method or payload returns `INVALID_INPUT`.
- Temp cleanup is best effort. Pending transaction and Git working-tree recovery follow accepted ADR-001. An ambiguous interrupted replacement or commit returns `STORAGE_RECOVERY_REQUIRED` and never overwrites a valid target automatically.
- Unknown kind/schema, malformed JSON and identity mismatch are explicit failures, never empty state.
- Successful content saves use the main-owned Git adapter and stable commit trailers defined by accepted ADR-001. No Git executable, command, repository handle, path, commit primitive or history capability crosses into renderer; 003 owns no history UI.
- 003 deletes only items whose authoritative `chapterRef` is null. A linked item returns `LINKED_DELETE_NOT_AVAILABLE` and changes nothing; atomic linked deletion is deferred to a future accepted 004 extension.
- Selection is current-session renderer state and is not stored in this document or another project file.

This contract is a durable boundary and must be accepted together with ADR-001 before implementation.
