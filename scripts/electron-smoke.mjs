import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');

if (!process.versions.electron) {
  const electron = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  if (!existsSync(electron)) throw new Error('Electron binary not found. Run bun install first.');
  const result = spawnSync(electron, [scriptPath], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });
  process.exit(result.status ?? 1);
}

const [{ ipcChannels }, { readFileSync }] = await Promise.all([
  import('../dist-electron/shared/ipc.js'),
  import('node:fs')
]);

if (ipcChannels.getRuntimeInfo !== 'writellm:runtime-info') {
  throw new Error('The compiled IPC contract is not the v2 foundation contract.');
}

const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'preload.cjs');
if (!existsSync(preloadPath) || !readFileSync(preloadPath, 'utf8').includes('getRuntimeInfo')) {
  throw new Error('The compiled preload bridge is missing its explicit runtime method.');
}

console.log('Electron foundation smoke test passed.');
