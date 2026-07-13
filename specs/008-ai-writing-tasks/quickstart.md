# Quickstart: validate the Pi writing agent design

This guide describes post-implementation validation. The feature is still gated; current baseline commands only prove the repository remains healthy.

## Prerequisites

- Accepted 004 block read/identity, 005 model/auth, 007 source read/location and ADR-001 writer contracts.
- Pi faux provider capable of scripted multi-turn tool calls.
- Temporary `.writellm` project with two target blocks, one unauthorized block, two authorized source chunks and one unauthorized chunk.
- Fault-injectable project/session storage.

## Scenario A: all content is read through tools

1. Create a task with two target IDs and two source refs.
2. Inspect faux-provider requests: the initial prompt contains instruction and opaque authorization summary, but no body/source text.
3. Script `read_task_brief`, `read_blocks` and `read_sources` calls.
4. Assert tool results contain only requested authorized content and `WritingTask.readAudit` records exact revisions/hashes.
5. Attempt unauthorized IDs and assert a typed tool error, no leaked content and no audit entry.

## Scenario B: proposal is tool-only

1. Script valid reads, then `submit_proposal`, then `finish_task`.
2. Assert proposal + completed task become durable atomically and body hashes remain unchanged.
3. Repeat with the assistant returning proposal-shaped JSON/prose without calling tools.
4. Assert no proposal is created and task fails `AGENT_NO_TERMINAL_TOOL`.

## Scenario C: evidence, extension and delete impact

- Reference an unread source: proposal tool rejects it.
- Submit no evidence with an explanation: proposal is accepted as insufficient/author judgment without fabricated refs.
- Suggest scope extension: only an authorized anchor and explicit extension marker are stored.
- Delete a block with descendants/references: system-computed impacts are stored; failed impact lookup makes it non-applicable.
- Submit a dependency group with missing/overlapping members: tool rejects it.

## Scenario D: author edits while agent runs

1. Start task and read a block at revision A.
2. Author edits it to revision B.
3. A later read reports changed-since-start; proposal base remains A and applicability becomes stale/manual review.
4. Assert the task never silently reads a newly selected/unselected block.

## Scenario E: cancel, late results and retry

1. Cancel a queued task; assert no harness/session starts.
2. Cancel during provider streaming, each read tool and proposal commit fault point.
3. Assert canceled barrier increments generation, `abort()` settles, late Pi events/tool updates cannot complete or create a proposal.
4. Retry and assert a new task/session with `sourceTaskId`; original is unchanged.

## Scenario F: crash/reopen

1. Leave a task durable as running with an unfinished Pi session/tool call.
2. Restart main.
3. Assert task becomes interrupted; no provider stream or tool call is replayed.
4. Explicit retry starts from current valid selections in a new session.

## Scenario G: IPC/security

- Malformed/oversized DTOs, project mismatch and untrusted sender fail before task creation.
- Renderer/preload expose no prompt, tool, transcript, path, credential, provider client or apply API.
- DOM/events/task DTOs omit transcript/tool contents/raw provider errors.
- Window remount reconstructs state with list/get; event loss does not lose durable status.

## Automated commands

```bash
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

The test suite must use Pi faux providers by default. A real-provider smoke is explicit opt-in, uses the saved 005 profile, discloses token/network use and never prints content or credentials.

## Current gate

Do not treat this guide as proof that 008 exists. Before implementation: accept the spec and revised plan, resolve the Pi session ADR gate, complete/accept hard dependencies, generate tasks, then add the fixtures and smoke cases above.
