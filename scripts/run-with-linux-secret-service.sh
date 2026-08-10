#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "usage: run-with-linux-secret-service.sh <command> [args...]" >&2
  exit 64
fi

keyring_password="${WRITELLM_CI_KEYRING_PASSWORD:-writellm-ci-keyring}"
if [[ "${WRITELLM_CI_SECRET_SERVICE_SESSION:-}" != '1' ]]; then
  runtime_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  keyring_runtime_dir="$(mktemp -d "${runtime_parent%/}/writellm-keyring-runtime.XXXXXX")"
  chmod 700 "$keyring_runtime_dir"
  export XDG_RUNTIME_DIR="$keyring_runtime_dir"
  export WRITELLM_CI_SECRET_SERVICE_SESSION=1
  exec dbus-run-session -- bash "$0" "$@"
fi

eval "$(printf '%s' "$keyring_password" | gnome-keyring-daemon --login --components=secrets)"
eval "$(gnome-keyring-daemon --start --components=secrets)"

probe_secret="writellm-ci-secret-service-probe"
printf '%s' "$probe_secret" | secret-tool store \
  --label='WriteLLM CI Secret Service probe' \
  service writellm-ci \
  account probe
stored_probe="$(secret-tool lookup service writellm-ci account probe)"
if [[ "$stored_probe" != "$probe_secret" ]]; then
  echo 'Linux Secret Service write/read probe failed' >&2
  exit 1
fi
secret-tool clear service writellm-ci account probe

export WRITELLM_E2E_PASSWORD_STORE=gnome-libsecret

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
electron_executable="$project_root/node_modules/.bin/electron"
if [[ ! -x "$electron_executable" ]]; then
  echo "Linux safeStorage probe could not find Electron at $electron_executable" >&2
  exit 1
fi
xvfb-run --auto-servernum "$electron_executable" \
  --password-store=gnome-libsecret \
  "$project_root/scripts/verify-linux-safe-storage.cjs"

exec "$@"
