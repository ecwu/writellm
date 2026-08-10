#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "usage: run-with-linux-secret-service.sh <command> [args...]" >&2
  exit 64
fi

keyring_password="${WRITELLM_CI_KEYRING_PASSWORD:-writellm-ci-keyring}"
runtime_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
keyring_runtime_dir="$(mktemp -d "${runtime_parent%/}/writellm-keyring-runtime.XXXXXX")"
chmod 700 "$keyring_runtime_dir"
export XDG_RUNTIME_DIR="$keyring_runtime_dir"

eval "$(printf '%s' "$keyring_password" | gnome-keyring-daemon --unlock --components=secrets)"

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
exec "$@"
