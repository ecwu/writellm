# writellm

An Electron application with React and TypeScript

## Implementation Status

WriteLLM v2 is being built incrementally from this starter. Before making implementation changes, read:

- [`AGENTS.md`](./AGENTS.md) for repository working rules.
- [`docs/architecture.md`](./docs/architecture.md) for fixed architecture and technology decisions.
- [`docs/implementation-todo.md`](./docs/implementation-todo.md) for the ordered roadmap and current checkpoint.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)

## Project Setup

The repository requires Node.js `24.15.0` or newer within the Node 24 major line, plus pnpm
`11.17.0`. On Debian/WSL x64, the bootstrap script installs Node and pnpm into the current user's
`~/.local`, installs the frozen dependency graph, and prepares the Electron native modules:

```bash
$ sudo apt-get update
$ sudo apt-get install -y build-essential python3 curl xvfb dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libxrandr2 libxdamage1 libxcomposite1
$ bash scripts/bootstrap-dev.sh
```

WSL does not need a desktop GUI. Install `xvfb` and run Electron commands headlessly:

```bash
$ xvfb-run --auto-servernum pnpm test:e2e
```

Windows NSIS and AppX packages must be built from native Windows x64 because the application
bundles platform-specific native modules. In an elevated or user-scoped PowerShell session, run:

```powershell
PS> Set-ExecutionPolicy -Scope Process Bypass
PS> .\scripts\bootstrap-dev.ps1
```

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# Windows NSIS installer (native Windows x64 host)
$ pnpm build:windows

# Windows AppX package (native Windows x64 host)
$ pnpm build:windows-app

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

The target package gate is intentionally native-host-only because `better-sqlite3` and
`sqlite-vec` are platform binaries. Linux x64 can be packaged inside WSL with `xvfb-run`; Windows
NSIS/AppX must run from Windows x64. These commands write deterministic artifacts under
`dist/windows-x64`, `dist/windows-appx`, and `dist/linux-x64`.
