import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';
import { registerSourceServiceHandlers } from '../../../src/main/sources/service-handlers';
import { sourceServiceChannels } from '../../../src/shared/sources';
import { SourceServiceValidationError } from '../../../src/main/sources/service-validator';

test('registers exactly seven sender-validated, strict and redacted service handlers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'source-service-ipc-'));
  const repository = new SourceServiceCredentials(
    dir,
    {
      available: async () => true,
      protect: async (value) => Buffer.from(value).toString('base64'),
      unprotect: async (value) => Buffer.from(value, 'base64').toString(),
    },
    () => 'revision-1',
  );
  await repository.initialize();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerSourceServiceHandlers({
    ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler as never) },
    repository,
    isExpectedSender: (event) => event === 'allowed',
    validate: async () => undefined,
  });
  expect([...handlers.keys()].sort()).toEqual(Object.values(sourceServiceChannels).sort());
  const unauthorized = await handlers.get(sourceServiceChannels.get)?.('blocked');
  expect(unauthorized).toMatchObject({
    status: 'error',
    error: { code: 'SOURCE_UNAUTHORIZED_SENDER' },
  });
  const invalid = await handlers.get(sourceServiceChannels.mineruSave)?.('allowed', {
    expectedRevision: null,
    credential: 'secret-sentinel',
    endpoint: 'https://evil.test',
  });
  expect(invalid).toMatchObject({ status: 'error', error: { code: 'SOURCE_INVALID_INPUT' } });
  expect(JSON.stringify(invalid)).not.toContain('secret-sentinel');
});

test('returns the validator stable error without leaking provider detail', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'source-service-ipc-'));
  const repository = new SourceServiceCredentials(
    dir,
    {
      available: async () => true,
      protect: async (value) => Buffer.from(value).toString('base64'),
      unprotect: async (value) => Buffer.from(value, 'base64').toString(),
    },
    () => 'revision-1',
  );
  await repository.initialize();
  await repository.save('siliconflow', null, 'secret-sentinel');
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerSourceServiceHandlers({
    ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler as never) },
    repository,
    isExpectedSender: () => true,
    validate: async () => {
      throw new SourceServiceValidationError('SOURCE_SILICONFLOW_RATE_LIMITED', true);
    },
  });

  const result = await handlers.get(sourceServiceChannels.siliconflowValidate)?.('allowed', {
    expectedRevision: 'revision-1',
  });
  expect(result).toMatchObject({
    status: 'error',
    error: { code: 'SOURCE_SILICONFLOW_RATE_LIMITED', retryable: true },
    currentSummary: { validation: { status: 'failed', code: 'SOURCE_SILICONFLOW_RATE_LIMITED' } },
  });
  expect(JSON.stringify(result)).not.toContain('secret-sentinel');
});
