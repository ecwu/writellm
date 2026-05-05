import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';
const preferredPort = 5173;
const children = new Set();

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = run(command, args);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
      }
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite at ${url}`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting at ${startPort}`);
}

function shutdown(code = 0) {
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

try {
  await runOnce('bun', ['x', 'tsc', '-p', 'tsconfig.electron.json']);
  const port = await findAvailablePort(preferredPort);
  const devServerUrl = `http://${host}:${port}`;
  const vite = run('bun', ['x', 'vite', '--host', host, '--port', String(port), '--strictPort']);
  await waitForServer(devServerUrl);
  const electron = run('bun', ['x', 'electron', '.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });

  electron.on('exit', (code) => {
    vite.kill('SIGTERM');
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
