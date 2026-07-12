# Workspace Leave Guard Extension Contract

This is a renderer-only extension consumed by the completed 002 workspace shell and owned by
the accepted 003 feature. It adds no IPC method and persists no shell or selection state.

```ts
type LeaveSaveResult =
  | { ok: true }
  | { ok: false; message: string };

type WorkspaceLeaveGuard = {
  ownerId: "writing-orientation";
  dirty: boolean;
  save(): Promise<LeaveSaveResult>;
  discard(): void;
};

type WorkspaceShellProps = {
  // Existing props omitted.
  leaveGuard?: WorkspaceLeaveGuard;
  onLeaveWorkspace(): void;
};
```

When the user requests project leave:

1. With no guard or `dirty === false`, shell invokes `onLeaveWorkspace()` immediately.
2. With `dirty === true`, shell opens a modal offering **Save and leave**, **Discard and
   leave**, and **Stay**. Closing or cancelling the modal is identical to Stay.
3. Save and leave disables repeated decisions while awaiting `save()`. On `{ ok: true }`, shell
   invokes `onLeaveWorkspace()` exactly once. On `{ ok: false }` or rejection, shell stays in the
   current project, keeps the draft mounted, shows only safe feature-provided failure text, and
   permits retry.
4. Discard and leave calls `discard()` once and then invokes `onLeaveWorkspace()` once. Stay calls
   neither callback.
5. A second leave request while save/discard is in flight is ignored. Unmount cancels UI handling
   of late results; it does not claim that an already submitted save was cancelled.

The feature owns dirty calculation, saving, discard semantics and safe error text. The shell owns
navigation orchestration, the confirmation modal, focus restoration and exactly-once leave. This
contract intentionally supports the single dirty owner required by 003; adding multiple concurrent
dirty owners requires a later accepted extension rather than an implicit array/priority policy.
