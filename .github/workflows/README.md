# GitHub Actions policy

`ci.yml` is the only enabled workflow. It runs static checks and recovery scenario inventory,
then the Windows x64, macOS arm64, macOS x64, and Linux x64 unsigned-package matrix only when a
tag is pushed. Platform jobs build and inspect artifacts; they do not run Vitest, E2E, or packaged
runtime smoke. Pull requests,
branch pushes, schedules, and manual dispatches do not trigger it.

`release-candidate.yml.disabled` remains intentionally disabled. GitHub does not recognize its
`.yml.disabled` suffix as a workflow file, so signing, promotion, and GitHub Release publication
cannot be started from that definition.

Do not add branch, pull-request, scheduled, or manual triggers, and do not restore the release
candidate workflow without fresh explicit user approval.

Each application is packaged once and reused for installer/archive production. Verification
timing JSON artifacts are uploaded even when a stage fails. The final read-only timing job reports
elapsed wait through the build jobs and cumulative job runtime separately, excluding itself.
These are observed runtimes, not billing figures or new performance acceptance limits.
