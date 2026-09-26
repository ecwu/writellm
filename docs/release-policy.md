# WriteLLM Release Policy

## Active distribution policy (clarified 2026-09-26)

The current distribution path is the unsigned four-platform tag build defined in
[the workflow policy](../.github/workflows/README.md) and recorded in the
[0.2026.9.8 publication evidence](history/implementation-log.md#2026-09-19-release-0202698-publication).
This supersedes the older macOS-only promotion and workflow-trigger provisions below.

- Keep the four-component release identifier and platform metadata mapping described below.
- Local release acceptance uses the complete Electron-hosted tests and `pnpm check:package`:
  static checks, recovery inventory, native/resource checks, packaged smoke, packaged E2E and
  installers produced from the same tested App. Report actual failures, reruns and platform limits.
- An immutable version tag on reviewed source triggers `ci.yml`: static/fixture checks followed
  by Windows x64, macOS arm64, macOS x64 and Linux x64 native builds. Hosted rows perform build
  and inventory checks, not runtime acceptance. Branch pushes and manual dispatch do not trigger CI.
- After all four rows succeed, verify each downloaded artifact's source revision, version,
  architecture, inventory, size and SHA-256 against its original platform evidence. Explicitly
  authorized GitHub Release publication is manual; verify uploaded assets before publishing.
- Ordinary releases disclose unsigned/unnotarized distribution and the actual runtime platforms
  tested. A normal, non-prerelease GitHub Release does not imply Developer ID signing or notarization.
- `release-candidate.yml.disabled` stays disabled. `pnpm check:release` and the historical protected
  promotion verifier remain fail-closed for an explicitly requested signed distribution; this
  policy does not relax their signing checks or authorize enabling their workflow.

The remaining macOS-only scope, workflow trust/trigger and promotion sections document the
superseded signed-distribution design. They do not authorize changing the active workflow.

## Release version

WriteLLM release candidates use a four-component calendar/build identifier. For
`0.2026.8.1`, `package.json#version` carries the valid three-component SemVer base `0.2026.8`,
while `package.json#release.version`, the Git tag, and artifact filenames carry `0.2026.8.1`.
The final component is the build sequence for that calendar version. The package gate maps it to
platform-native metadata: Windows `FileVersion` uses all four components, macOS
`CFBundleVersion` uses the compatible three-component `2026.8.1`, and Linux uses package
iteration `1`. Promotion fails closed when the release tag, SemVer base, row evidence, or artifact
metadata disagree.

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

## macOS-first distribution scope

The active distribution scope was narrowed on 2026-08-10 to `macos`: macOS arm64 and macOS x64
must both build, test, package, and provide complete promotion evidence from the same immutable
tag. Windows x64 and Linux x64 remain supported package targets and CI diagnostics, but they are
deferred release rows and cannot appear in a macOS-scoped release manifest or GitHub Release.

This avoids spending further hosted minutes or blocking a usable macOS candidate on unresolved
Windows/Linux evidence. The alternatives considered were continuing to require all four rows,
which conflicts with the active budget and delivery priority, or silently accepting a partial
four-row manifest, which would weaken the fail-closed verifier. Instead, the release workflow and
manifest carry an explicit target set and require its exact rows. Existing four-row evidence stays
valid under the `all` target set; it is not reclassified as macOS-only evidence. Resuming Windows
or Linux distribution requires an explicit roadmap update, successful native rows, and a new
promotion run. No application data or artifact-format migration is required.

Release evidence manifest schema version 2 adds the required `targetSet` field. Version 1 evidence
remains historical input only and cannot be promoted through the target-scoped workflow.

## Workflow trust and retention

- Workflow and job permissions default to `contents: read`. Only the protected promotion job may
  request `contents: write`.
- External actions are pinned to reviewed immutable commit SHAs. Dependency caches accelerate the
  frozen pnpm install but never replace `pnpm-lock.yaml` verification.
- Pull requests run the static/fixture gate plus the Linux critical Electron smoke. Protected-main
  pushes run only the static/fixture gate. Tag CI and the default release-candidate dispatch run
  the two active macOS rows and their package/artifact layer; four-platform validation requires an
  explicit `all` release target set and remains deferred.
- Synthetic test reports and failed diagnostics are retained for 14 days. Successful main/nightly
  unsigned native packages are retained for 30 days. Migration/recovery fixtures are
  version-controlled for the full supported migration window.
- Diagnostics uploaded by CI must be synthetic and sanitized. Credentials, prompts, responses,
  document bodies, signed URLs, private paths, and real user projects are prohibited.
- Linux positive-path Electron and package jobs start a temporary CI-only Secret Service and opt
  the test harness into Electron's `gnome-libsecret` password store explicitly. The harness fails
  closed when that opt-in is absent or encryption is unavailable. The packaged smoke also launches
  once with `--password-store=basic` and requires truthful `basic_text` reporting plus
  credential-persistence rejection.

## Promotion

The `release-candidate` workflow checks out an exact tag, rebuilds and verifies every native row in
the selected target set, and sends only that exact complete output to the `release` environment.
The active and default target set is `macos`; the `all` target set is retained only for explicitly
resuming four-platform validation. Repository administrators must configure that environment with
the desired required reviewers.

`dry-run` promotion is test-only and may retain unsigned packages; it never creates a GitHub
Release. Production promotion is currently allowed only for the `macos` target set and is
fail-closed until its evidence proves Developer ID signing and notarization for both macOS rows.
The deferred `all` target set would additionally require Authenticode signing for Windows and
checksums/build metadata for Linux before production distribution can be reconsidered. Provider
secrets are never passed to build jobs, and deterministic loopback providers remain the release
gate.

Release artifacts are copied to an immutable GitHub Release together with `SHA256SUMS` and a
release manifest containing the exact tag, revision, target, architecture, package inventory, and
signature state. Failed, skipped, partial, mismatched, or unsigned-when-required rows cannot be
promoted.
