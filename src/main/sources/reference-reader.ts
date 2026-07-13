import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CHAPTER_KIND, CHAPTER_SCHEMA_VERSION } from '../../shared/chapters.js';
import type { ProjectSession } from '../project/project-transaction.js';

export class SourceReferenceReader {
  async countReferences(session: ProjectSession, sourceId: string): Promise<number | 'unknown'> {
    const directory = path.join(session.projectRoot, 'workspace', 'chapters');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : 'unknown';
    }
    let count = 0;
    for (const name of names.filter((value) => value.endsWith('.json'))) {
      try {
        const value = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as Record<
          string,
          unknown
        >;
        if (
          value.kind !== CHAPTER_KIND ||
          value.schemaVersion !== CHAPTER_SCHEMA_VERSION ||
          value.projectId !== session.projectId ||
          !Array.isArray(value.citations)
        )
          return 'unknown';
        for (const citation of value.citations) {
          if (
            !isRecord(citation) ||
            typeof citation.sourceId !== 'string' ||
            typeof citation.chunkId !== 'string'
          )
            return 'unknown';
          if (citation.sourceId === sourceId) count++;
        }
      } catch {
        return 'unknown';
      }
    }
    return count;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
