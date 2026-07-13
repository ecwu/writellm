import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRuntime = process.env.WRITELLM_SOURCE_RUNTIME === '1';
const preload = await readFile(path.join(root, 'dist-electron/preload/preload.cjs'), 'utf8');
for (const name of [
  'getAppearancePreferences',
  'updateAppearancePreferences',
  'openForOutlineItem',
  'previewMarkdownExport',
  'exportMarkdown',
  'getProviderSummary',
  'saveProviderSettings',
  'replaceProviderSecret',
  'removeProviderSecret',
  'validateProvider',
]) {
  if (!preload.includes(name)) throw new Error(`Missing compiled method ${name}`);
}
for (const namespace of [
  'writellm',
  'writellmAppearance',
  'writellmWritingOrientation',
  'writellmChapters',
  'writellmProviderSettings',
  ...(sourceRuntime ? ['writellmSources', 'writellmSourceServices'] : []),
]) {
  if (
    !preload.includes(`exposeInMainWorld("${namespace}"`) &&
    !preload.includes(`exposeInMainWorld('${namespace}'`)
  )
    throw new Error(`Missing compiled preload namespace ${namespace}.`);
}
if (sourceRuntime) {
  for (const method of [
    'listSources',
    'importSourcesFromDialog',
    'getSource',
    'retrySource',
    'removeSource',
    'subscribeSourceEvents',
    'getServiceStatus',
    'saveMinerUCredential',
    'removeMinerUCredential',
    'validateMinerUCredential',
    'saveSiliconFlowCredential',
    'removeSiliconFlowCredential',
    'validateSiliconFlowCredential',
  ]) {
    if (!preload.includes(method)) throw new Error(`Missing compiled source method ${method}`);
  }
}
const bundle = await readFile(path.join(root, 'dist/index.html'), 'utf8');
if (!bundle.includes('assets/')) throw new Error('Compiled renderer bundle is missing.');

async function runRuntime({ argument, environment, expectedMarker, label }) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'writellm-ui-runtime-'));
  const marker = path.join(temp, 'lifecycle.log');
  await writeFile(marker, '');
  const child = spawn(
    path.join(root, 'node_modules/.bin/electron'),
    [
      path.join(root, 'dist-electron/main/main.js'),
      `--user-data-dir=${path.join(temp, 'data')}`,
      '--disable-gpu',
      argument,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        WRITELLM_SMOKE: '1',
        WRITELLM_EDITOR_RUNTIME: '0',
        WRITELLM_WORKSPACE_NAVIGATION_RUNTIME: '0',
        WRITELLM_SMOKE_MARKER: marker,
        WRITELLM_SOURCE_RUNTIME: sourceRuntime ? '1' : '0',
        WRITELLM_SOURCE_RUNTIME_ROOT: sourceRuntime ? path.join(temp, 'source-project') : '',
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  child.stdout?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} UI runtime startup timed out.`));
    }, 15_000);
    child.on('exit', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  const lifecycle = await readFile(marker, 'utf8');
  await rm(temp, { recursive: true, force: true });
  if (code !== 0)
    throw new Error(
      `${label} UI runtime exited ${code}. Lifecycle: ${lifecycle || '(empty)'} Diagnostics: ${diagnostics || '(empty)'}`,
    );
  if (!lifecycle.includes(expectedMarker))
    throw new Error(
      `${label} mount was not observed. Lifecycle: ${lifecycle || '(empty)'} Diagnostics: ${diagnostics || '(empty)'}`,
    );
}

await runRuntime({
  argument: '--writellm-editor-runtime',
  environment: { WRITELLM_EDITOR_RUNTIME: '1' },
  expectedMarker: 'editor-mounted',
  label: 'Compiled BlockNote',
});
await runRuntime({
  argument: '--writellm-workspace-navigation-runtime',
  environment: { WRITELLM_WORKSPACE_NAVIGATION_RUNTIME: '1' },
  expectedMarker: 'workspace-navigation-mounted',
  label: 'Compiled workspace navigation',
});
console.log(
  'Compiled UI runtime passed: secure bridge inventory, actual BlockNote mount, workspace navigation switching, Settings, and sandboxed startup.',
);
