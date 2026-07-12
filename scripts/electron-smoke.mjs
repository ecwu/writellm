import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');
const electronPath = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const mainPath = path.join(projectRoot, 'dist-electron', 'main', 'main.js');
const preloadPath = path.join(projectRoot, 'dist-electron', 'preload', 'preload.cjs');

if (!existsSync(electronPath) || !existsSync(mainPath) || !existsSync(preloadPath)) throw new Error('Build the application before running the Electron smoke test.');

const ipcSource = await readFile(path.join(projectRoot, 'dist-electron', 'shared', 'ipc.js'), 'utf8');
const preloadSource = await readFile(preloadPath, 'utf8');
for (const method of ['listRecentProjects', 'createProject', 'openProjectFromDialog', 'openRecentProject', 'relinkRecentProject', 'removeRecentProject']) {
  if (!ipcSource.includes(method) || !preloadSource.includes(method)) throw new Error(`Compiled project IPC is missing ${method}.`);
}
if (ipcSource.includes('getRuntimeInfo') || preloadSource.includes('getRuntimeInfo') || preloadSource.includes('ipcRenderer.send')) throw new Error('Compiled bridge contains a forbidden legacy or generic IPC capability.');

async function waitForMarker(marker, text, process, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(marker, 'utf8')).includes(text)) return;
    } catch {
      // The primary has not written its lifecycle marker yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (process.exitCode !== null) break;
  }
  throw new Error(`Timed out waiting for Electron lifecycle marker: ${text}`);
}

function launch(userData, marker, hold) {
  return spawn(electronPath, [mainPath, `--user-data-dir=${userData}`, '--disable-gpu'], {
    cwd: projectRoot,
    env: { ...process.env, WRITELLM_SMOKE: '1', ...(hold ? { WRITELLM_SMOKE_HOLD: '1' } : {}), WRITELLM_SMOKE_MARKER: marker, ELECTRON_ENABLE_LOGGING: '0' },
    stdio: 'ignore'
  });
}

async function runOneShot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-electron-smoke-'));
  const marker = path.join(root, 'lifecycle.log');
  const child = launch(path.join(root, 'user-data'), marker, false);
  try {
    await waitForMarker(marker, 'ready', child);
    await new Promise((resolve, reject) => child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Electron startup exited with ${code}.`))));
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(root, { recursive: true, force: true });
  }
}

async function runDualProcess() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-electron-dual-'));
  const userData = path.join(root, 'user-data');
  const marker = path.join(root, 'lifecycle.log');
  const primary = launch(userData, marker, true);
  let secondary;
  try {
    await waitForMarker(marker, 'ready', primary);
    secondary = launch(userData, marker, true);
    const secondaryCode = await new Promise((resolve) => secondary.once('exit', (code) => resolve(code)));
    if (secondaryCode !== 0) throw new Error(`Secondary Electron process exited with ${secondaryCode}.`);
    await waitForMarker(marker, 'second-instance', primary);
    if (primary.exitCode !== null) throw new Error('Primary Electron process exited while handling the secondary launch.');
  } finally {
    if (secondary && secondary.exitCode === null) secondary.kill('SIGTERM');
    if (primary.exitCode === null) primary.kill('SIGTERM');
    await rm(root, { recursive: true, force: true });
  }
}

await runOneShot();
await runDualProcess();
console.log('Electron project foundation smoke test passed: compiled bridge, startup, and single-instance lifecycle.');
