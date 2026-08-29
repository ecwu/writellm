# GitHub Actions policy

`ci.yml` is the only enabled workflow. It runs the complete Windows x64, macOS arm64, macOS x64,
and Linux x64 validation and unsigned-package matrix only when a tag is pushed. Pull requests,
branch pushes, schedules, and manual dispatches do not trigger it.

`release-candidate.yml.disabled` remains intentionally disabled. GitHub does not recognize its
`.yml.disabled` suffix as a workflow file, so signing, promotion, and GitHub Release publication
cannot be started from that definition.

Do not add branch, pull-request, scheduled, or manual triggers, and do not restore the release
candidate workflow without fresh explicit user approval.
