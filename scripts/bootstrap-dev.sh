#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_version="24.15.0"
local_prefix="${HOME}/.local"
node_root="${local_prefix}/node-v${node_version}"
node_archive="${TMPDIR:-/tmp}/writellm-node-v${node_version}-linux-x64.tar.xz"

if [[ "${OSTYPE:-}" != linux* || "$(uname -m)" != x86_64 ]]; then
  echo "This bootstrap script currently supports Linux x64 only; use .node-version with your Windows/macOS toolchain." >&2
  exit 1
fi

mkdir -p "${local_prefix}/bin"
if [[ ! -x "${node_root}/bin/node" ]]; then
  curl --fail --location --retry 3 "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz" --output "${node_archive}"
  rm -rf "${node_root}"
  mkdir -p "${local_prefix}"
  tar -xJf "${node_archive}" -C "${local_prefix}"
  mv "${local_prefix}/node-v${node_version}-linux-x64" "${node_root}"
fi

ln -sfn "${node_root}/bin/node" "${local_prefix}/bin/node"
ln -sfn "${node_root}/bin/npm" "${local_prefix}/bin/npm"
ln -sfn "${node_root}/bin/npx" "${local_prefix}/bin/npx"
PATH="${local_prefix}/bin:${PATH}"
export PATH

if [[ "$(pnpm --version 2>/dev/null || true)" != "11.17.0" ]]; then
  npm install --global --prefix "${local_prefix}" pnpm@11.17.0
fi

echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Installing the frozen dependency graph..."
pnpm install --frozen-lockfile --ignore-scripts

if [[ "${WRITELLM_SKIP_NATIVE:-0}" != 1 ]]; then
  echo "Preparing Electron native modules for Linux x64..."
  node "${project_root}/scripts/prepare-native-target.mjs" --install --target=linux-x64
fi

cat <<'EOF'

WriteLLM development environment is ready for Linux x64.
For WSL without a GUI, run Electron/E2E commands through:
  xvfb-run --auto-servernum pnpm test:e2e
Linux package:
  xvfb-run --auto-servernum pnpm build:linux
Windows NSIS and Windows AppX must be packaged on a native Windows x64 host:
  pnpm build:windows
  pnpm build:windows-app
EOF
