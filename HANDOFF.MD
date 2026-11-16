# Maintenance handoff

## 2026-11-07 Code knots

The local branch is `codex/untangle-code-knots`, based on `707eb15`.
The current plan and history log record the completed work and acceptance results.

When moving an exported error, update combined imports and every `instanceof` consumer.
Keep one constructor identity across the callers.
Use the runtime contract's failure codes in test fixtures.
The first two attempts each failed static analysis and were rolled back before correction.

Writing Agent and Notebook intentionally differ in completion policy.
Writing Agent respects an explicit false retry flag and omits completion metadata on timeout.
Notebook derives retryability from HTTP status as well as the flag and retains metadata without external response IDs.
`model-call-completion.ts` preserves these differences. Eighteen database scenarios cover the policy combinations.

Environment findings:

- The sandbox denies Git metadata writes. Creating the branch required approved host access for the exact Git command.
- Installed pnpm is 11.17.0, while the project pins 11.28.3. Direct Node entry points passed without changing the pin or installing dependencies.
- Host Node is 26.13.0, outside the declared 24.x range. Electron tests used bundled Node 24.21.0 through `scripts/run-tests.mjs`.
- TypeScript 7 does not expose the old parser API at its package root. Reuse `scripts/lib/ts-source.mjs` for supported token scanning.
- Codex browser setup found no IAB backend. An isolated headless Chrome process rendered the local HTML successfully.
- Electron interaction tests required approved host process and loopback access. Use the documented silent runner with its selected filters.

The working entry points are `node scripts/run-checks.mjs fast`, `node scripts/run-tests.mjs <filters>`, and `node scripts/run-checks.mjs build`.
Use `node scripts/run-e2e.mjs <filters>` with the required host capability.
The non-fatal macOS `task_name_for_pid` diagnostic did not prevent normal test completion.

The static map covers relative imports in implementation TypeScript files, including type imports.
It does not infer dynamic IPC connections or external packages.
The larger session, mutation, and project services still need separate responsibility reviews.

## 2026-11-07 Continuation

Read session records through `AgentSessionQueries`. Get transient activity from the coordinator.
Run interrupted Agent recovery at project startup, before the runtime accepts work.
Keep mutation evidence scoped to a successful `read_section` result from the exact conversation and run.
When changing the snapshot barrier, preserve the export flush purpose and the checkpoint option that skips a flush.
These exceptions are deliberate. The initial checkpoint and template application use the skip option.

Each refactor starts from a local snapshot of its affected files.
If a gate fails, restore that snapshot to preserve earlier uncommitted repairs.
All four changes pass the local gates on their first attempt.

## 2026-11-07 Agent message queue

Keep Steer and Follow-up history writes at their respective delivery points.
After model request creation yields, recheck Follow-up capacity before adding the waiting item.
If the recheck fails, abort the request before worker delivery.
Use UTF-8 bytes for the aggregate limit. Direct Steer does not consume Follow-up capacity.

The first host approval review for `e2e/agent-concurrency.spec.ts` timed out before launch.
The exact scenario passed after one retry. Both completed scenario runs had zero test retries.

## 2026-11-07 Code ownership maintenance

Check the generated image asset before simulating the patch in the application transaction.
Use revision metadata for workspace summaries. Decode section bodies after the read callback for full assembly.
Use the shared Worker trace filter for provider response headers. Keep Main trace redaction in place.
Search for consumers before removing forwarding exports. Some shared contracts intentionally re-export public types.

## 2026-11-07 Project lifecycle ownership

Initial close continues after errors. Retry skips completed steps and stops at the first error.
Remove stale import staging only after project open holds the write lock and opens the database.
Plan creation must preserve other plan directories. The earlier test expected cleanup in the wrong owner.
Skip interrupted journal recovery only for the active restore's own reopen.

If a turn interruption leaves no terminal build report, inspect the recorded process handle before starting another build.
The resumed close build passed after the original process handle disappeared. Its static and test results remained valid.

## 2026-11-07 Queue delivery and retirement

Keep pending model request IDs until the durable abort succeeds. Settlement uses them to retry unfinished requests.
Remove worker authorization and context snapshots before saving the abort.

Select `e2e/agent-concurrency.spec.ts` directly. The scenario ID does not appear in its Playwright test title.
The ID filter selects zero tests. The spec contains one scenario.

## 2026-11-07 Knowledge artifact readers

Reuse raw manifest and content-list reads only within one Mapping request. Keep separate recovery paths for geometry and provenance.
Require a recorded manifest hash for published reads. Publication recovery alone can reconstruct a missing hash.
Keep the remote task and published file checks in the recovery path.
Use a statement for a lazy cache assignment. Biome rejected an assignment inside the conditional expression.


## 2026-11-07 Normalized Knowledge readers

Hash the raw JSONL bytes during the block scan. Hashes include line endings and the optional final newline.
Only use the verifier callback to validate or collect blocks. Wait for verification before publishing results.
Use byte offsets for page cursors. Preserve golden chunk IDs for existing normalized files.

Require a recorded normalized manifest hash for published reads. Only publication recovery can proceed without that hash.
Use the active normalization run for parsed images. For a historical revision, use its highest published normalization version.


## 2026-11-07 Index scheduling and fingerprints

Use the index service to request a rebuild. New refresh jobs carry an empty payload and a durable claim deadline.
Keep accepting legacy generation fields. Older binaries require that field on refresh jobs.
Keep the handler delay for legacy refresh jobs and leave item removal eligible immediately.

Use the worker's existing source fingerprint encoding. SQLite's binary sort can differ from the worker's sort for mixed-case IDs.
Use the same chunk ordering during build and reopen. The regression test exercises a real SQLite reopen.


## 2026-11-07 Embedding contract and index cleanup

Narrow the provider role before reading its endpoint. Some image providers have no `baseUrl`.
Keep the existing hash field order. Include the endpoint in the hash and keep it out of the worker contract.
Use the expected contract hash inside the provider credential callback for queries and build batches.
Keep the migration for legacy publish jobs. The current build handler performs activation.


## 2026-11-07 Embedding refresh admission and activation

Check active embedding jobs by type inside the enqueue transaction. The job list returns a limited page.
Handle a deduplicated enqueue as a busy result. Only log a new refresh if the job store creates one.
Compare the current source generation after the last wait before enqueue. Compare it again before activation.

Use the durable job schema to distinguish automatic, whole-project, and item embedding jobs.

## 2026-11-07 Embedding refresh recovery

Create the vector generation and clear the selected cache in one worker transaction.
A legacy generation can exist before its first cache clear. A saved vector proves that the refresh passed that boundary.
Keep older jobs without a saved target readable. Older binaries reject the new target field.
Compare both the text generation and provider contract before resuming a saved refresh.

Use an isolated package output directory when release artifacts already occupy the default target.
Run the package inventory and runtime checks against that same app. Use its executable for the targeted Electron scenarios.


## 2026-11-07 Vector write and activation integrity

Validate every incoming chunk ID and hash inside the vector write transaction.
sqlite-vec rejects an existing primary key even with `INSERT OR REPLACE`. Delete the same chunk's mapped vector before inserting the replacement.
Use a conflict target on the chunk map. A row ID collision must fail without replacing another chunk's map.
Require matching chunk IDs and hashes before switching active generations. Reject obsolete candidates before changing the active row.


## 2026-11-07 Vector retention and reads

Use the worker's internal retention path to delete vector generations. The former deletion command had no caller.
Prune obsolete vectors inside the activation transaction. A failed prune must leave the previous generation active.
Check the active text generation before serving vector queries or previews. The vector state can still be active after a text switch.

## 2026-11-07 Search candidate snapshots

Rank and load each candidate list in the worker using the same active text generation.
Recheck the generation after provider work. Keep the retry bounded.
Audit the SQL heading filter before changing search ranking. Its wildcard and case rules can differ from the literal match in the worker.

## 2026-11-07 Agent queue persistence and Steer dispatch

Share the queued message payload and request settings. Keep each history write at its delivery boundary.
Keep the promotion reservation until Main commits Steer. Reuse the reserved message and the new request ID when the worker dispatches Steer.

Stop can finish while a Steer call waits for history publication. The guard draft can try to abort a request that settlement already aborted.
The repository accepts abort only for a running request. Define which path owns the abort before retrying this guard.

## 2026-11-07 Agent queue lifetime

Share each pending request abort between queue cleanup and settlement.
Keep the request pending until its abort write succeeds. If a concurrent queue abort fails, let settlement retry it.
Check the original run handle again after history publication. Stop can cancel delivery after Main saves the Steer message.
Reject queue commands before posting them if the client handle has ended.
In a test publication callback, use an async function if only one branch waits. The first guard attempt fails the return-path type check.

## 2026-11-07 Agent queue cleanup and cancellation

Release image references where Main clears the queue. Review and overflow also use that path.
Enter compaction before waiting for old model requests to abort. This prevents admission into a queue that recovery will clear.
Use the worker's cancellation signal to reject both authorization waits. Pi can absorb their errors, so check cancellation before returning a result.
After Stop, let settlement clean up the queue. Main skips the late Follow-up authorization.

## 2026-11-07 Tool continuation lifetime

Wait for pending continuation saves before settlement reads its list of requests. Keep Notebook metadata-only retention.
Use a new continuation scope for overflow recovery. The old scope is closed before recovery starts.
Check worker identity before dispatching replies. Check request identity again after a handler waits.
Use the supervisor's pending request table before posting commands. Reject duplicate queue action IDs while their first replies are pending.

## 2026-11-07 Notebook startup and cancellation

Register the real completion before publishing the first snapshot. Signal Stop before publishing the stopping phase.
Track the first request before checking cancellation after its save. Settlement then aborts the row if the worker never starts.
Share one promise for default-model initialization. Ignore catalog results after Close.
Reserve preparation before waiting on sources and the catalog. Cancel the reservation from Stop, Clear, and Close.
The catalog resolver has no signal. Check the reservation again before committing its result.
One Electron host approval times out before launch. The same command passes on its one allowed retry.

## 2026-11-07 Notebook source reconciliation and turn history

Ignore source results older than the latest applied read. Compare against the live context after the lookup.
Keep the last confirmed effective source set while the index is preparing or unavailable. New turns still require a ready index.
Recheck the source set after model resolution, even when chat is empty. Capture bounded history before saving the model request.

## 2026-11-07 Notebook capacity and Stop cleanup

Advance source context even when chat has no space for another marker. Preserve the existing messages.
Measure each message as UTF-8 text. Compare the old and new assistant content before accepting a delta.
Keep the capacity error as the abort reason. This lets the turn report the limit after the worker stops.
Treat stopping and final snapshots as notifications. Clear the Stop timer when cleanup finishes.

## 2026-11-07 Search heading filters

Match decoded heading text before the full-text or vector limit. Normalize both the heading path and the filter.
Register the SQLite function on each index connection. Existing index files need no migration.
Generate each SQL clause with its bound values. Use the same builder for direct candidate loads.
Load ranked results within the same worker call. Their filters already ran against that generation.
If a MinerU fixture adds a heading, update the expected normalized block count.

Audit provenance loading next. Ranked candidates decode source detail fields that only citation expansion returns.

## 2026-11-07 Agent queue authorization and delivery cleanup

Save the Follow-up model request when Main queues the message. Authorize model events only after Main writes the consumed message to history.
Keep the context snapshot with the waiting message until consumption or promotion. Both paths authorize the request with that snapshot.
When cleanup stops a run, compare the worker handle from the failed delivery with the current handle.
The queue scenario now waits for the provider calls for Steer and Follow-up in order.

## 2026-11-07 Index source provenance

Load block IDs, pages, and asset references for ranked search. Decode bounding boxes only for callers that need source locations.
Use the shared location decoder for both citation expansion and Mapping. A bounding box must be null or four finite numbers.
The first projection attempt rolls back after Biome rejects a long line in the regression test.
Format both changed files before starting the verification gates.

Audit Mapping row limits next. Its SQL reads every matching source row before Main receives the too-complex result.

## 2026-11-07 Mapping row limits and block lookups

Read one row above each worker limit. This lets the worker reject overflow without truncating a valid page.
Count all source rows of the selected chunks. Some rows can refer to other pages.
Merge ranges for block selection. Use the original chunk range for coverage because its offsets start at that range.

Audit the chunker next. It builds the text of the current group again for each block. The chunker and Mapping also define the block separator separately.

## 2026-11-07 Chunk grouping and Mapping rules

Track rendered text length and the active image while building a group. Finish the group when the next block breaks its rules.
Keep the existing UTF-16 length rule for grouping. Use Unicode code points for chunk segments and Mapping offsets.
Read the separator from one definition. Share caption identity checks and keep each caller's own rule for finding the candidate image.

Audit large caption groups next. Each segment receives all group sources, but the index response accepts at most 1,000 sources per chunk.

## 2026-11-07 Segment provenance and asset limits

Store only the source blocks that overlap each segment. Rebase coverage offsets to the first contributing block.
Keep the original group coordinates in the chunk ID. Use the generation format to rebuild old source rows from normalized artifacts.
Use one distinct asset limit for the chunker and both response schemas. A group that exceeds the limit now splits.
Use the shared generation ID builder in Main test fixtures. The first attempt rolls back after ten tests use the old format.

Audit the startup fingerprint next. It copies the source ID array for each row, so larger chunks cause repeated allocation.

## 2026-11-07 Startup fingerprint allocation

Keep the SQL order of each chunk's source IDs. Append each row directly to the list for its chunk.
Sort fingerprint entries in JavaScript. Hash the same JSON array encoding one entry at a time.
The fixed fixture digest covers encoding compatibility. The clean-reopen test rejects reordered source IDs.

Audit Main readiness reads next. Three calls use the diagnostic snapshot only for the active generation ID.

## 2026-11-07 Index readiness probes and recovery

Use the ID response for startup and live readiness. Keep activation counts for diagnostic logs.
Read the current source generation after the worker replies. Confirm it before reporting readiness or queuing an embedding refresh.
Set readiness to available when a queued build activates successfully after startup fails.

Audit runtime recovery next. A worker restart can return no active generation while Main only reports that the index is preparing.

## 2026-11-07 Index worker runtime recovery

Share the worker startup and its retry through one promise. Wait for the replacement to report readiness before posting requests.
Notify Main once for each successful replacement. Main compares the active ID with the current sources and uses the existing durable build key.
Keep the first startup on the project open path. Do not run restart scheduling again for each request that waited for the same worker.

Audit project close during index recovery next. The worker can stop while Main still removes the derived SQLite files.

## 2026-11-07 Index shutdown and recovery cleanup

Wait for recovery file removal before normal close or forced termination completes. Startup still receives any file removal error.
Block new requests when close starts. Send the close command directly to the running worker.
Share concurrent close calls and clear their promise when shutdown settles. A later retry can finish a project close after an error.

Audit the index header check in ProjectManager next. It opens the derived database before the worker starts and records a separate readiness flag.

## 2026-11-07 Derived index ownership

Use worker readiness for live project state. Keep `indexRebuildRequired` in snapshot manifests and archive fixtures.
The first removal attempt rolls back after five history tests lose the archive field. Limit the removal to live project data.
Create the derived database in the Index worker. The worker can also initialize a header-only file from an older version.
Snapshot creation always excludes the derived index. Use the shared index path to reject the file and its SQLite sidecars in inventories.

Audit failed project open after runtime startup next. That cleanup stops the scheduler and releases the lock through a separate path.

## 2026-11-07 Agent queue delivery and admission

Keep the worker check after the history write. A Stop during publication blocks dispatch for direct Steer, promotion, and consumption.
Register saved queue requests before the second admission check. If its abort write fails, run cleanup can retry it.
The first admission test expects a shortened error and triggers a rollback. Use the full capacity error in the assertion.
Audit saves that return after run cleanup ends. Those requests still depend on the caller to abort them.

## 2026-11-07 Agent queue settlement

Close queue admission before waiting for request saves. Wait for database writes only, because Renderer publication can overlap Stop.
Use the existing shared abort operation. Retry it once even if run cleanup starts the first attempt.
An unused save does not fail an otherwise successful run. Keep interrupted output tied to an authorized request.

Audit failed project open after worker startup next. Compare its cleanup with the verified close steps in ProjectManager.

## 2026-11-07 Project open and close cleanup

Keep the database and lock until claims stop and workers drain and stop. Revoke subscriptions independently of those steps.
On failed open, clean up only the resources that open acquired. Return the original failure and retain unfinished cleanup for retry.
Transfer the lock before calling canonical open. Its cleanup owns the lock even if reading the manifest fails.

Audit ProjectWriteLock.release next. It marks the handle released before the filesystem operations finish.
Audit checkpoint restore journal recovery before lock acquisition. The journal recovery can rename the project root before Main tests for contention.

## 2026-11-07 Project lock release and owner validation

Keep the lock handle available until release finishes. Save the directory identity before moving the owner file.
Concurrent release calls share one attempt. A failed attempt leaves the handle available for retry.
Stale-lock recovery uses the observed metadata path. Reject a file if its name and owner token differ.
Release retry state lives in the current process. An interrupted process can leave a release marker or empty lock directory.

Audit checkpoint restore journal recovery before lock acquisition next. It can rename project directories before Main tests for contention.

## 2026-11-07 Checkpoint restore recovery

Use one journal replay for startup and failed restore. If rollback moves the candidate aside, the next replay must find its history there.
Return both history.git and its ignore file before moving the original project back. Keep the journal if replay fails.
Match project manifests before moving project directories. Keep the missing-root recovery path for a crash between directory moves.

Design cross-process exclusion next. The project lock lives inside the directory that restore moves.
Protect the gap between close and candidate open. Preserve old journals, missing-root recovery, and normal open without parent write access.

## 2026-11-07 Checkpoint journal replay locks

Acquire the write locks before replay moves project directories. Move each lock with its directory.
Recheck the journal after acquiring locks. Use the directory that blocked replay for explicit stale-lock recovery.
The checkpoint restore lock handoff below now covers the normal swap.

## 2026-11-07 Editor save requests and session cleanup

Share the request and acknowledgment. Keep each caller's timeout and missing-subscriber policy.
Match the reply's sender, session, and purpose. A close request can omit its purpose.
Keep worker shutdown hooks out of editor IPC. Clear the active section through the same callback that revokes its requests.

## 2026-11-07 Manuscript revision writes and request lifetime

Keep revision validation and transaction scope with each caller. Share the write, current pointer update, and comment anchor mapping.
Register cancellable IPC work through the shared project request helper. Check the session again before returning the result.

## 2026-11-07 Publication citation capture

Derive publication references from the captured manuscript. Do not read the current revisions again to build the reference index.
Pass the same manuscript and reference items to the formatter. Keep citation clusters in manuscript order.

## 2026-11-07 Section Markdown export

Check the requested revision ID and hash against the manuscript capture that supplies the Markdown text and citation numbers.
Use the capture to test stale revision rejection in editor IPC. A separate editor read cannot exercise this path.

## 2026-11-07 Import metadata and image references

Read the active revision ID and hash from the same workspace metadata as the brief and outline versions.
Use the asset service scan for the image IDs in a revision. Keep the export registration and file integrity checks at the export boundary.

## 2026-11-07 Editor refresh and Agent notification delivery

Route Agent and replacement notifications through the shared editor refresh. Keep the fallback section policy with the Agent path.
Send each Agent mutation event once per window. Every Preload listener sees the window message and keeps its own subscription lifetime.

## 2026-11-07 Agent refresh ownership

Use the Main mutation event to refresh the manuscript. Keep the Agent panel focused on the proposal result and revision transitions.
Use `subscribeMutations` for Citation coverage. Refresh coverage only when the event includes `sectionChanged`.

## 2026-11-07 Agent session reads and proposal approval

Use the normal user-message refresh to show completed writing guidance. Clear the pending marker so the next text delta does not start another refresh.
Reuse the proposal preview for the editor flush before ordinary approval. Revalidate the proposal in the write transaction.
Keep the image-specific editor flush at its existing point in the generation sequence.

## 2026-11-07 Editor section selection and save requests

Use the revision from the selected section when creating a save request. Read the current revision again after the acknowledgment.
Use the workbench's selected section and `editor.loadSection` for editor navigation.

## 2026-11-07 Editor save result and file repair

Report the result from the revision transaction. An identical retry can use an older base revision and still succeed.
Verify the derived file during an identical retry. If the file is missing or invalid, rebuild it from SQLite in the section's publication queue.

## 2026-11-07 Section loading and navigation

Use `editor.setActiveSection` to select the final-save target. A section read must leave that target alone.
Let the workbench update the tab after editor activation. The editor activation callback updates only the editor selection and metadata.

## 2026-11-07 Section creation and outline recovery

Use the new section's revision ID to write its initial file.
Keep the refresh after a failed write inside the outline queue. The next action needs the current outline version.

## 2026-11-07 Writing workspace save coordination

Read the latest title-save callback after layout persistence completes. Use the shared subscription for the lifetime of the project session.
Clear title errors in the title hook when the user edits the draft. Remove the view's direct error setter when moving this state.

## 2026-11-07 Writing workspace navigation

Keep section switches in the workbench queue. Wait for the matching revision before revealing a Find result.
Clear the pending Find reveal and visible highlight through the same action.

## 2026-11-07 Checkpoint restore lock handoff

Keep the original lock through close. Lock the candidate before moving either directory.
Pass the installed directory's lock into reopen. If reopen fails, give journal replay the locks already held.
If shutdown fails, let close recovery retain the lock until it finishes stopping the project.

## 2026-11-07 Launcher project diagnostics

Wait for the application to close before moving a project directory in a test.
The project close command can return before all cleanup finishes.
Keep the original error as a cause when adding a safe diagnostic reason.
Use a locked SQLite backup when reconstructing a missing manifest. Keep checkpoint history and backups at the source.

## 2026-11-07 OpenAI sign-in diagnosis

Pi 1.5 requires a stable installation UUID for ChatGPT sign-in on `builtin:openai`.
The catalog calls `models.login` without the fourth argument that supplies `getDeviceId`.
The app log and a local Pi probe both report "Sign in with ChatGPT requires a device ID (UUID) for this installation".
Pi rejects the call before it provides a browser URL. Settings closes the dialog and shows a generic error.
Exercise `builtin:openai` when testing a repair. The existing project lifecycle scenario exercises `builtin:openai-codex`.

The repair reads or creates the UUID in one application database transaction. Pi calls it when the provider needs the ID.
The provider settings scenario now exercises both presets. It intercepts the browser launch and uses the real local callback on port 1455.
Use the isolated Electron fixture and a simulated token response for this test.

## 2026-11-08 Local macOS app rebuild

The package gate clears the whole target directory, including earlier installers.
For an app-only rebuild, use electron-builder with the package gate's arguments and a staging directory.
Make sure that the inventory and focused runtime test pass before replacing the app bundle.
The earlier DMG, ZIP, and package evidence stay together in the target directory.

## 2026-11-08 Vendor patch whitespace

Keep the space prefix on context lines in unified diff files.
If Git flags these lines during staging, check added lines inside the patch separately.
