import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('MinerU live smoke is explicit, uses the official example, redacted, temporary, and outside default CI', async () => {
  const root = process.cwd();
  const script = await readFile(path.join(root, 'scripts/mineru-live-smoke.mjs'), 'utf8');
  const launcher = await readFile(path.join(root, 'scripts/mineru-live-launcher.mjs'), 'utf8');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(script).toContain("process.env.WRITELLM_MINERU_LIVE_SMOKE === '1'");
  expect(script).toContain('https://cdn-mineru.openxlab.org.cn/demo/example.pdf');
  expect(script).toContain('adapter.submitRemoteFile');
  expect(script).not.toContain('syntheticPdf()');
  expect(script).toContain("mkdtemp(path.join(os.tmpdir(), 'writellm-mineru-live-'))");
  expect(script).toContain('rm(temporaryRoot, { recursive: true, force: true })');
  expect(script).toContain("path.join(app.getPath('appData'), 'writellm')");
  expect(script).not.toContain('/Documents/');
  expect(script).not.toContain('original.pdf');
  expect(launcher).toContain('mineru-live-smoke.mjs');
  expect(launcher).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  expect(pkg.scripts['test:mineru-live']).toContain('scripts/mineru-live-launcher.mjs');
  for (const command of ['test', 'check', 'test:all'])
    expect(pkg.scripts[command]).not.toContain('test:mineru-live');
});
