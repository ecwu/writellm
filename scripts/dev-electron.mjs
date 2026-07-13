import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';

const children = new Set();
let stopping = false;
let electron = null;
let sourceWatcher = null;
let rebuildPending = false;
let rebuilding = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  sourceWatcher?.close();
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else child.once('exit', resolve);
  });
}

async function compileElectron() {
  const compile = run('bun', ['x', 'tsc', '-p', 'tsconfig.electron.json']);
  return await waitForExit(compile);
}

function launchElectron(url) {
  const child = run('bun', ['x', 'electron', '.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  electron = child;
  child.on('exit', (code) => {
    if (electron === child) {
      electron = null;
      if (!rebuilding) stop(code ?? 0);
    }
  });
}

async function rebuildElectron(url) {
  rebuildPending = true;
  if (rebuilding) return;
  rebuilding = true;
  while (rebuildPending && !stopping) {
    rebuildPending = false;
    const code = await compileElectron();
    if (code !== 0) continue;
    const previous = electron;
    electron = null;
    if (previous) {
      previous.kill('SIGTERM');
      await waitForExit(previous);
    }
    if (!stopping) launchElectron(url);
  }
  rebuilding = false;
}

async function waitForVite(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite at ${url}`);
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

try {
  const compileCode = await compileElectron();
  if (compileCode !== 0) stop(compileCode ?? 1);

  const url = 'http://127.0.0.1:5173';
  run('bun', ['x', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
  await waitForVite(url);
  launchElectron(url);
  const sourceRoot = path.resolve('src');
  sourceWatcher = watch(sourceRoot, { recursive: true }, (_event, filename) => {
    if (typeof filename === 'string' && /^(main|preload|shared)[/\\].+\.(?:cts|ts)$/.test(filename))
      void rebuildElectron(url);
  });
} catch (error) {
  console.error(error);
  stop(1);
}
