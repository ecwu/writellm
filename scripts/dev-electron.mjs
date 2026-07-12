import { spawn } from 'node:child_process';

const children = new Set();
let stopping = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
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
  const compile = run('bun', ['x', 'tsc', '-p', 'tsconfig.electron.json']);
  const compileCode = await new Promise((resolve) => compile.on('exit', resolve));
  if (compileCode !== 0) stop(compileCode ?? 1);

  const url = 'http://127.0.0.1:5173';
  run('bun', ['x', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
  await waitForVite(url);
  const electron = run('bun', ['x', 'electron', '.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  electron.on('exit', (code) => stop(code ?? 0));
} catch (error) {
  console.error(error);
  stop(1);
}
