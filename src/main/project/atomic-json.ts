import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type AtomicJsonFailureStage = 'mkdir' | 'write' | 'rename' | null;

export type AtomicJsonOptions = {
  token?: string;
  failureStage?: AtomicJsonFailureStage;
};

export async function writeAtomicJson<T>(filePath: string, value: T, options: AtomicJsonOptions = {}): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  if (options.failureStage === 'mkdir') throw new Error('injected atomic mkdir failure');

  const token = options.token ?? randomUUID();
  const temporaryPath = `${filePath}.${token}.tmp`;
  try {
    if (options.failureStage === 'write') throw new Error('injected atomic write failure');
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    if (options.failureStage === 'rename') throw new Error('injected atomic rename failure');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function isAtomicTemporaryName(name: string, token: string): boolean {
  return name.endsWith(`.${token}.tmp`);
}

