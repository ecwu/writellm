#!/usr/bin/env bash

set -euo pipefail

verify_only="${WRITELLM_CI_VERIFY_ONLY:-0}"
if [[ "${1:-}" == '--verify-only' ]]; then
  verify_only='1'
  export WRITELLM_CI_VERIFY_ONLY=1
  shift
fi

if [[ "$verify_only" == '1' && "$#" -ne 0 ]]; then
  echo 'run-with-linux-secret-service.sh --verify-only accepts no command' >&2
  exit 64
fi
if [[ "$verify_only" == '0' && "$#" -eq 0 ]]; then
  echo "usage: run-with-linux-secret-service.sh [--verify-only | <command> [args...]]" >&2
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

if [[ "${WRITELLM_CI_XVFB_SESSION:-}" != '1' ]]; then
  export WRITELLM_CI_XVFB_SESSION=1
  exec xvfb-run --auto-servernum bash "$0" "$@"
fi

eval "$(printf '%s' "$keyring_password" | gnome-keyring-daemon --login --components=secrets)"
eval "$(gnome-keyring-daemon --start --components=secrets)"

# Electron's Linux password-store discovery also consults the desktop session.
# Hosted runners do not advertise one, so provide the supported GNOME identity
# in addition to the explicit --password-store=gnome-libsecret switch.
export XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-GNOME}"

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

if [[ "$verify_only" == '1' ]]; then
  project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
  electron_executable="$project_root/node_modules/.bin/electron"
  if [[ ! -x "$electron_executable" ]]; then
    echo "Linux safeStorage probe could not find Electron at $electron_executable" >&2
    exit 1
  fi
  "$electron_executable" \
    --no-sandbox \
    --password-store=gnome-libsecret \
    "$project_root/scripts/verify-linux-safe-storage.cjs"
  exit 0
fi

exec "$@"
