import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled recovery boundary fences project sessions, retries, removal and late results', async () => {
  const [main, runtime, scheduler, removal, repository] = await Promise.all([
    readFile('dist-electron/main/main.js', 'utf8'),
    readFile('dist-electron/main/sources/source-runtime.js', 'utf8'),
    readFile('dist-electron/main/sources/scheduler.js', 'utf8'),
    readFile('dist-electron/main/sources/removal-service.js', 'utf8'),
    readFile('dist-electron/main/sources/source-repository.js', 'utf8'),
  ]);
  expect(main).toContain("app.on('before-quit'");
  expect(runtime).toContain('active.sessionId === session.sessionId');
  expect(scheduler).toContain('recoverExpiredLeases');
  expect(removal).toContain('supersedeSource');
  expect(removal).toContain('timingSafeEqual');
  expect(repository).toContain('writellm.source-tombstone');
  expect(repository).toContain('SOURCE_NOT_FOUND');
});
