import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const electronPath = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
);
const entry = path.join(projectRoot, 'scripts', 'mineru-live-smoke.mjs');
const child = spawn(electronPath, [entry, '--disable-gpu'], {
  cwd: projectRoot,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

const timeout = setTimeout(() => child.kill('SIGTERM'), 21 * 60_000);
const code = await new Promise((resolve) => child.once('exit', resolve));
clearTimeout(timeout);
process.exitCode = typeof code === 'number' ? code : 1;
