import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';
const preferredPort = 5173;
const children = new Set();
let electron = null;
let restartingElectron = false;
let shuttingDown = false;
let restartTimer = null;
let skipInitialTypecheckWatchBuild = true;
let typecheckWatchOutput = '';

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
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  for (const child of children) {
    child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

function startElectron(devServerUrl) {
  if (shuttingDown) {
    return;
  }
  const nextElectron = run('bun', ['x', 'electron', '.'], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });
  electron = nextElectron;
  nextElectron.on('exit', (code) => {
    if (electron !== nextElectron) {
      return;
    }
    electron = null;
    if (shuttingDown) {
      return;
    }
    if (restartingElectron) {
      restartingElectron = false;
      startElectron(devServerUrl);
      return;
    }
    shutdown(code ?? 0);
  });
}

function scheduleElectronRestart(devServerUrl) {
  if (shuttingDown || restartTimer) {
    return;
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (shuttingDown || restartingElectron) {
      return;
    }
    if (!electron) {
      startElectron(devServerUrl);
      return;
    }
    restartingElectron = true;
    electron.kill('SIGTERM');
  }, 150);
}

function startElectronTypecheckWatch(devServerUrl) {
  const typecheck = run(
    'bun',
    ['x', 'tsc', '-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput', '--pretty', 'false'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const handleOutput = (chunk, output) => {
    const text = chunk.toString();
    output.write(text);
    typecheckWatchOutput = `${typecheckWatchOutput}${text}`;
    if (!typecheckWatchOutput.includes('Found 0 errors. Watching for file changes.')) {
      typecheckWatchOutput = typecheckWatchOutput.slice(-512);
      return;
    }
    typecheckWatchOutput = '';
    if (skipInitialTypecheckWatchBuild) {
      skipInitialTypecheckWatchBuild = false;
      return;
    }
    scheduleElectronRestart(devServerUrl);
  };
  typecheck.stdout.on('data', (chunk) => handleOutput(chunk, process.stdout));
  typecheck.stderr.on('data', (chunk) => handleOutput(chunk, process.stderr));
  typecheck.on('exit', (code) => {
    if (!shuttingDown) {
      console.error('Electron TypeScript watcher stopped.');
      shutdown(code ?? 1);
    }
  });
}

try {
  await runOnce('bun', ['x', 'tsc', '-p', 'tsconfig.electron.json']);
  const port = await findAvailablePort(preferredPort);
  const devServerUrl = `http://${host}:${port}`;
  const vite = run('bun', ['x', 'vite', '--host', host, '--port', String(port), '--strictPort']);
  await waitForServer(devServerUrl);
  startElectronTypecheckWatch(devServerUrl);
  startElectron(devServerUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
}
