import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, net, safeStorage } from 'electron';

const enabled = process.env.WRITELLM_MINERU_LIVE_SMOKE === '1';
const officialExampleUrl = 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf';
if (!enabled) {
  console.error(
    'MinerU live smoke is opt-in because it submits the official example.pdf URL and the saved credential to MinerU. Set WRITELLM_MINERU_LIVE_SMOKE=1 to run it.',
  );
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const electronProfile = await mkdtemp(path.join(os.tmpdir(), 'writellm-mineru-electron-'));
app.setName('writellm');
app.setPath('userData', electronProfile);
app.commandLine.appendSwitch('disable-gpu');
console.log(JSON.stringify({ status: 'phase', phase: 'electron-starting' }));

async function main() {
  console.log(JSON.stringify({ status: 'phase', phase: 'electron-ready' }));
  let temporaryRoot;
  try {
    const [
      { SourceJobRepository },
      { MinerUAdapter },
      { SourceServiceCredentials },
      { SourceEvents },
      { SourcePipeline },
      { SourceRepository },
    ] = await Promise.all([
      import(path.join(projectRoot, 'dist-electron/main/sources/job-repository.js')),
      import(path.join(projectRoot, 'dist-electron/main/sources/mineru-adapter.js')),
      import(path.join(projectRoot, 'dist-electron/main/sources/service-credentials.js')),
      import(path.join(projectRoot, 'dist-electron/main/sources/source-events.js')),
      import(path.join(projectRoot, 'dist-electron/main/sources/source-pipeline.js')),
      import(path.join(projectRoot, 'dist-electron/main/sources/source-repository.js')),
    ]);
    const applicationUserData =
      process.env.WRITELLM_USER_DATA ?? path.join(app.getPath('appData'), 'writellm');
    const credentials = new SourceServiceCredentials(
      path.join(applicationUserData, 'source-services'),
      {
        available: async () => safeStorage.isEncryptionAvailable(),
        protect: async (value) => safeStorage.encryptString(value).toString('base64'),
        unprotect: async (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
      },
    );
    await credentials.initialize();
    const mineruSummary = credentials.summary('mineru');
    if (!mineruSummary.revision || !mineruSummary.configured)
      throw new Error('SOURCE_MINERU_NOT_CONFIGURED');
    await credentials.readCredential('mineru', mineruSummary.revision);
    const smokeCredentials = {
      summary: (provider) => {
        const summary = credentials.summary(provider);
        return provider === 'mineru' ? { ...summary, available: true } : summary;
      },
      readCredential: (provider, revision) => credentials.readCredential(provider, revision),
    };
    console.log(JSON.stringify({ status: 'phase', phase: 'credential-ready' }));

    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'writellm-mineru-live-'));
    await writeFile(path.join(temporaryRoot, 'project.json'), '{}\n');
    const session = {
      projectId: 'mineru-live-smoke',
      projectRoot: temporaryRoot,
      sessionId: randomUUID(),
    };
    const originalResponse = await net.fetch(officialExampleUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!originalResponse.ok) throw new Error('SOURCE_OFFICIAL_EXAMPLE_UNAVAILABLE');
    const originalBytes = new Uint8Array(await originalResponse.arrayBuffer());
    console.log(JSON.stringify({ status: 'phase', phase: 'official-example-ready' }));
    const repository = new SourceRepository({
      isCurrentSession: (candidate) => candidate.sessionId === session.sessionId,
    });
    const created = await repository.createSource(session, {
      expectedCatalogRevision: 0,
      displayName: 'example.pdf',
      sizeBytes: originalBytes.byteLength,
      sha256: createHash('sha256').update(originalBytes).digest('hex'),
      originalBytes,
    });
    if (created.status !== 'created') throw new Error('SOURCE_SETUP_FAILED');

    const jobs = new SourceJobRepository(temporaryRoot);
    await jobs.initialize();
    const job = await jobs.enqueue({
      kind: 'writellm.source-job',
      schemaVersion: 1,
      jobId: randomUUID(),
      projectId: session.projectId,
      sourceId: created.source.sourceId,
      sourceVersionId: created.sourceVersionId,
      type: 'parse',
      state: 'queued',
      attempt: 0,
      idempotencyKey: `${created.source.sourceId}:${created.sourceVersionId}:parse`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(JSON.stringify({ status: 'phase', phase: 'pipeline-starting' }));
    const pipeline = new SourcePipeline({
      credentials: smokeCredentials,
      repository,
      events: new SourceEvents(),
      getActiveSession: () => session,
      request: (input, init) => net.fetch(input, init),
      mineru: (credential) => {
        const adapter = new MinerUAdapter(credential, (input, init) => net.fetch(input, init));
        return {
          submitLocalPdf: async (input) => {
            const submitted = await adapter.submitRemoteFile({
              url: officialExampleUrl,
              dataId: input.dataId,
              modelVersion: input.modelVersion,
              ocr: input.ocr,
              tables: input.tables,
              formulas: input.formulas,
              signal: input.signal,
            });
            const durableTaskId = `task:${submitted.remoteTaskId}`;
            await input.onBatchAllocated?.(durableTaskId);
            return { remoteBatchId: durableTaskId };
          },
          poll: ({ remoteBatchId, signal }) => {
            if (!remoteBatchId.startsWith('task:')) throw new Error('SOURCE_TASK_ID_MALFORMED');
            return adapter.pollTask({ remoteTaskId: remoteBatchId.slice(5), signal });
          },
          download: (input) => adapter.download(input),
        };
      },
      pollIntervalMs: 5_000,
    });
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 20 * 60_000);
    const reporter = setInterval(() => {
      const progress = jobs.get(job.jobId)?.progress;
      console.log(
        JSON.stringify({
          status: 'progress',
          completed: progress?.completed ?? 0,
          total: progress?.total ?? 100,
        }),
      );
    }, 5_000);
    try {
      await pipeline.process(job, controller.signal, jobs);
    } finally {
      clearTimeout(deadline);
      clearInterval(reporter);
    }

    const detail = await repository.get(session, job.sourceId);
    const versionRoot = path.join(
      temporaryRoot,
      'sources',
      job.sourceId,
      'versions',
      job.sourceVersionId,
    );
    const manifest = JSON.parse(await readFile(path.join(versionRoot, 'manifest.json'), 'utf8'));
    const markdown = await readFile(path.join(versionRoot, 'full.md'), 'utf8');
    const blocks = (await readFile(path.join(versionRoot, 'blocks.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    const media = await readdir(path.join(versionRoot, 'media')).catch(() => []);
    if (
      detail?.state !== 'indexing' ||
      manifest.parseState !== 'complete' ||
      markdown.length === 0 ||
      blocks.length === 0 ||
      media.length !== manifest.mediaCount
    )
      throw new Error('SOURCE_LIVE_SMOKE_INCOMPLETE');
    console.log(
      JSON.stringify({
        status: 'completed',
        sourceState: detail.state,
        markdownBytes: Buffer.byteLength(markdown),
        blockCount: blocks.length,
        mediaCount: media.length,
        parseState: manifest.parseState,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: 'failed',
        code:
          typeof error?.code === 'string' ? error.code : (error?.message ?? 'LIVE_SMOKE_FAILED'),
        phase: typeof error?.phase === 'string' ? error.phase : undefined,
        httpStatus: typeof error?.httpStatus === 'number' ? error.httpStatus : undefined,
      }),
    );
    process.exitCode = 1;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    await rm(electronProfile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
}

app.whenReady().then(main);
