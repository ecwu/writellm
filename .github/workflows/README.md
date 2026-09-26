# GitHub Actions policy

`ci.yml` is the build workflow. It runs static checks and recovery scenario inventory,
then the Windows x64, macOS arm64, macOS x64, and Linux x64 unsigned-package matrix only when a
tag is pushed. Platform jobs build and inspect artifacts; they do not run Vitest, E2E, or packaged
runtime smoke. Pull requests,
branch pushes, schedules, and manual dispatches do not trigger it.

`release-candidate.yml.disabled` remains intentionally disabled. GitHub does not recognize its
`.yml.disabled` suffix as a workflow file, so signing, promotion, and GitHub Release publication
cannot be started from that definition.

On 2026-09-26 the user explicitly authorized server-side automatic publication after the
four-platform tag build, eliminating local download/re-upload and the need to keep a computer
online. `publish-release.yml` is enabled for successful `Cross-platform tag build` completion.
It also accepts a manual `run_id` and `tag` on the default branch to resume an already-completed
build (including a tag created before this workflow existed), without rebuilding or rerunning tests.

The publication job alone has `contents: write`; build jobs remain read-only. Publishing code
is checked out from the trusted default branch with persisted credentials disabled. Before any
release write, `scripts/publish-release.mjs` checks the source repository, fixed `ci.yml` workflow,
push event, successful current run attempt and all four platform jobs, tag/release version,
exact tag SHA, default-branch ancestry and per-platform artifact identity. Downloads are extracted
under runner temporary storage and never executed. Selected files must match the original
package evidence's revision, architecture, size and SHA-256. This is artifact provenance and
integrity verification, not another build or runtime acceptance gate.

A draft is populated with exactly four packages: Windows x64 EXE, macOS arm64 DMG, macOS x64
DMG and Linux x64 AppImage. After upload digests match, it is published as a normal, non-prerelease
Release. JSON evidence and alternative ZIP/DEB files remain CI artifacts. Retries may fill missing
matching draft assets; they cannot overwrite mismatched assets or change the tag. A complete
matching public release is a no-op. Release-specific notes may live in `docs/releases/<version>.md`;
the publisher always adds the exact source, build link, downloads and unsigned distribution notice.

Keep builds tag-only: do not add branch, pull-request, scheduled or manual build triggers, and do
not restore the disabled signed release-candidate workflow without fresh explicit user approval.
The separate manual publication trigger only reuses an existing successful tag build.

Each application is packaged once and reused for installer/archive production. Verification
timing JSON artifacts are uploaded even when a stage fails. The final read-only timing job reports
elapsed wait through the build jobs and cumulative job runtime separately, excluding itself.
These are observed runtimes, not billing figures or new performance acceptance limits.
