#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo "usage: run-with-linux-secret-service.sh <command> [args...]" >&2
  exit 64
fi

keyring_password="${WRITELLM_CI_KEYRING_PASSWORD:-writellm-ci-keyring}"
eval "$(printf '%s' "$keyring_password" | gnome-keyring-daemon --login --components=secrets)"
eval "$(gnome-keyring-daemon --start --components=secrets)"

export WRITELLM_E2E_PASSWORD_STORE=gnome-libsecret
exec "$@"
