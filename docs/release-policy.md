# WriteLLM Release Policy

## Native build rows

Release candidates are built only on the matching generally available GitHub-hosted architecture.
The pinned image labels recorded on 2026-07-30 are:

| Target | Runner label | Runtime artifact |
| --- | --- | --- |
| Windows x64 | `windows-2022` | NSIS |
| macOS arm64 | `macos-15` | DMG and ZIP |
| macOS x64 | `macos-15-intel` | DMG and ZIP |
| Linux x64 | `ubuntu-24.04` | AppImage and deb |

Moving `*-latest` aliases, preview architectures, cross-compilation, and paid macOS larger-runner
labels are not accepted as substitutes. A runner-label change requires an explicit roadmap update
and a new native package row.

## Workflow trust and retention

- Workflow and job permissions default to `contents: read`. Only the protected promotion job may
  request `contents: write`.
- External actions are pinned to reviewed immutable commit SHAs. Dependency caches accelerate the
  frozen pnpm install but never replace `pnpm-lock.yaml` verification.
- Pull requests run the static gate plus Electron tests/build/E2E on all four rows, but skip the
  expensive package/artifact layer. Pushes to protected main, nightly schedules, and
  release-candidate dispatches run the complete package matrix as well.
- Synthetic test reports and failed diagnostics are retained for 14 days. Successful main/nightly
  unsigned native packages are retained for 30 days. Migration/recovery fixtures are
  version-controlled for the full supported migration window.
- Diagnostics uploaded by CI must be synthetic and sanitized. Credentials, prompts, responses,
  document bodies, signed URLs, private paths, and real user projects are prohibited.
- Linux positive-path Electron and package jobs start a temporary CI-only Secret Service. The
  packaged smoke also launches once with `--password-store=basic` and requires truthful
  `basic_text` reporting plus credential-persistence rejection.

## Promotion

The `release-candidate` workflow checks out an exact tag, rebuilds and verifies every native row,
and sends only complete matrix output to the `release` environment. Repository administrators must
configure that environment with the desired required reviewers.

`dry-run` promotion is test-only and may retain unsigned packages; it never creates a GitHub
Release. `production` promotion is fail-closed until the matrix evidence proves Developer ID
signing and notarization for both macOS rows plus Authenticode signing for Windows. Linux artifacts
require checksums and build metadata. Provider secrets are never passed to build jobs, and
deterministic loopback providers remain the release gate.

Release artifacts are copied to an immutable GitHub Release together with `SHA256SUMS` and a
release manifest containing the exact tag, revision, target, architecture, package inventory, and
signature state. Failed, skipped, partial, mismatched, or unsigned-when-required rows cannot be
promoted.
