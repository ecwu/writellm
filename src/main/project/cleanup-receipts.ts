import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLEANUP_INDEX_KIND, PROJECT_SCHEMA_VERSION, isRecord, type CleanupReceipt, type CleanupReceiptIndex } from '../../shared/project.js';
import { writeAtomicJson } from './atomic-json.js';
import { validateProjectDirectory } from './project-validation.js';

const fileName = 'pending-project-cleanups.json';

export class CleanupReceipts {
  private readonly indexPath: string;
  private receipts: CleanupReceipt[] = [];
  warning: string | undefined;

  constructor(userDataPath: string) {
    this.indexPath = path.join(userDataPath, fileName);
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown;
      if (!isRecord(parsed) || parsed.kind !== CLEANUP_INDEX_KIND || parsed.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(parsed.receipts)) {
        this.warning = 'Some interrupted project setup could not be inspected safely.';
        return;
      }
      this.receipts = parsed.receipts.filter(isReceipt);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') this.warning = 'Some interrupted project setup could not be inspected safely.';
    }
  }

  async add(finalRoot: string): Promise<CleanupReceipt> {
    const receipt: CleanupReceipt = { finalRoot, token: randomUUID(), createdAt: new Date().toISOString() };
    const next = [...this.receipts, receipt];
    await writeAtomicJson(this.indexPath, { kind: CLEANUP_INDEX_KIND, schemaVersion: PROJECT_SCHEMA_VERSION, receipts: next });
    this.receipts = next;
    return receipt;
  }

  async remove(receipt: CleanupReceipt): Promise<void> {
    const next = this.receipts.filter((candidate) => candidate.token !== receipt.token || candidate.finalRoot !== receipt.finalRoot);
    await writeAtomicJson(this.indexPath, { kind: CLEANUP_INDEX_KIND, schemaVersion: PROJECT_SCHEMA_VERSION, receipts: next });
    this.receipts = next;
  }

  async cleanup(): Promise<void> {
    for (const receipt of [...this.receipts]) {
      const validation = await validateProjectDirectory(receipt.finalRoot);
      if (validation.ok) {
        await this.remove(receipt).catch(() => undefined);
        continue;
      }
      try {
        const names = await readdir(receipt.finalRoot);
        const expectedTemp = `project.json.${receipt.token}.tmp`;
        const safeNames = names.every((name) => name === 'workspace' || name === expectedTemp);
        if (safeNames && names.includes(expectedTemp)) {
          await rm(receipt.finalRoot, { recursive: true, force: true });
          await this.remove(receipt).catch(() => undefined);
        } else {
          this.warning = 'An interrupted project setup was retained for safety.';
        }
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') await this.remove(receipt).catch(() => undefined);
        else this.warning = 'An interrupted project setup could not be cleaned up.';
      }
    }
  }
}

function isReceipt(value: unknown): value is CleanupReceipt {
  return isRecord(value) && typeof value.finalRoot === 'string' && path.isAbsolute(value.finalRoot) && typeof value.token === 'string' && typeof value.createdAt === 'string';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

