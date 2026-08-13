$ErrorActionPreference = 'Stop'

$requiredNodeVersion = '24.15.0'
$requiredPnpmVersion = '11.17.0'

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'WriteLLM Windows packaging requires a 64-bit Windows host.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
  $wingetCommand = Get-Command winget -ErrorAction SilentlyContinue
  if ($null -eq $wingetCommand) {
    throw 'Node.js 24.15.0 is missing. Install the official x64 Node.js LTS release, then rerun this script.'
  }
  winget install --id OpenJS.NodeJS --version $requiredNodeVersion --exact --scope user --accept-package-agreements --accept-source-agreements
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) {
    throw 'Node.js was installed but is not available in this PowerShell session. Open a new PowerShell window and rerun this script.'
  }
}

$nodeVersion = (& node --version).TrimStart('v')
if ($nodeVersion -ne $requiredNodeVersion) {
  throw "Expected Node.js $requiredNodeVersion, found $nodeVersion. Install the pinned version before continuing."
}

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -eq $pnpmCommand) {
  npm install --global "pnpm@$requiredPnpmVersion"
}

$pnpmVersion = (& pnpm --version).Trim()
if ($pnpmVersion -ne $requiredPnpmVersion) {
  throw "Expected pnpm $requiredPnpmVersion, found $pnpmVersion. Install the pinned version before continuing."
}

pnpm install --frozen-lockfile
pnpm run prepare:native

Write-Host ''
Write-Host 'Windows development environment is ready.'
Write-Host 'Build the native Windows packages with:'
Write-Host '  pnpm build:windows'
Write-Host '  pnpm build:windows-app'
