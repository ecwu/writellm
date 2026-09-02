# ADR 075: Agent Panel Presentation

Status: accepted
Date: 2026-09-02

## Context

The user approved a single typed presentation projection for the existing Agent sidebar.
Timeline rendering, live text, tool labels, status, disclosure, and Details previously interpreted
the same records independently.

Source references are pinned to [OpenCode TimelineRow](https://github.com/anomalyco/opencode/blob/b04697366f05419e9bd7a92f841813dd976161c9/packages/app/src/pages/session/timeline/timeline-row.ts),
[OpenCode parts](https://github.com/anomalyco/opencode/blob/b04697366f05419e9bd7a92f841813dd976161c9/packages/session-ui/src/components/message-part.tsx),
[Codex ThreadItem](https://github.com/openai/codex/blob/095ac4f131e759b204fa6368dc42d2feff6eb21a/codex-rs/app-server-protocol/src/protocol/v2/item.rs),
[Codex HistoryCell](https://github.com/openai/codex/blob/095ac4f131e759b204fa6368dc42d2feff6eb21a/codex-rs/tui/src/history_cell/mod.rs),
and [Pi tool presentation](https://github.com/earendil-works/pi/blob/4e69b0c28060f0f02fbe38bfa7c21a2e2eb25057/packages/coding-agent/src/modes/interactive/components/tool-execution.ts).
OpenCode separates message parts from presentation rows and groups context reads. Codex separates
compact display from transcript detail and shares cells between live and committed output. Pi
separates tool execution from call/result presentation. Codex evidence concerns its public
app-server/TUI only, not the desktop client's private implementation.

## Decision

One Renderer-owned pure projection consumes existing events, runs, proposals, live text, and
section metadata. Its six discriminated content types are message, activity, change, question,
compaction, and notice. Timeline, current activity, and technical Details consume that projection.
Plain objects and a static exhaustive tool presentation table replace scattered classification;
there is no dynamic registry, class hierarchy, or new authority.

- User and assistant prose remains visible. Live and persisted assistant text share rendering.
  Durable sequence de-duplication and terminal protection govern live-text settlement.
- Adjacent visible tools group only within one run. Running groups default open, successful groups
  closed, and failed/partial/stopped groups open. Manual disclosure choices survive updates using
  stable item identity; failure summaries remain visible even when manually collapsed.
- Only activate_tool_groups, get_writing_task, create_writing_task, and update_writing_task are
  internal. Running internal work informs the header, successful work stays in Details, and
  failed/stopped work becomes a visible notice. The existing task dock retains the writing plan.
- Successful reads display validated titles/pages, never model-authored title guesses. Tool
  outputs remain in bounded Details. Parallel-group duration is a wall-clock span, not a sum.
- Changes use proposal/revision truth and the existing native preview. Pending review opens;
  settled results collapse. Generation, conflicts, and failures retain concrete visible states.
- Live questions use the existing answer dock. History contains the question/answer once, without
  duplicate synthesized prompts. Compaction has one lifecycle identity and settles its spinner.
- Non-blocking errors show a concrete one-line message with collapsed diagnostics. Run failures
  and interruptions remain visible; successful completion contributes duration once per run.
- Filtering presentation never deletes history. Legacy readers and bounded diagnostics remain;
  raw reasoning, private traces, credentials, and privileged access stay outside the Renderer.

## Consequences

This amends ADRs 016/065 only for centralized presentation and the four internal tools' visibility.
The established shadcn desktop shell, task/attention docks, approval/answer/undo authority,
database schema, IPC, Worker protocol, and Pi versions remain unchanged. No dependency, feature
flag, persisted UI cache, or new model request is introduced. Verification targets projection,
stream settlement, disclosure transitions, and the affected real Electron Agent scenarios.
