import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RemoveSourceResult } from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import type { SourceReferenceReader } from './reference-reader.js';
import type { SourceEvents } from './source-events.js';
import type { SourceRepository } from './source-repository.js';

type TokenPayload = {
  projectId: string;
  sourceId: string;
  sourceRevision: number;
  catalogRevision: number;
  expiresAt: number;
};

export class SourceRemovalService {
  private secret = randomBytes(32);
  constructor(
    private options: {
      repository: SourceRepository;
      references: SourceReferenceReader;
      events: SourceEvents;
      activeJobCount(sourceId: string): number;
      supersedeSource(sourceId: string): Promise<void>;
      now?: () => number;
    },
  ) {}

  async remove(
    session: ProjectSession,
    input: { sourceId: string; expectedSourceRevision: number; confirmationToken?: string },
  ): Promise<RemoveSourceResult> {
    const listed = await this.options.repository.list(session, { limit: 100 });
    const source = listed.sources.find((value) => value.sourceId === input.sourceId);
    if (!source || source.revision !== input.expectedSourceRevision)
      return { status: 'conflict', currentSource: source, catalogRevision: listed.catalogRevision };
    if (!input.confirmationToken) {
      const references = await this.options.references.countReferences(session, input.sourceId);
      if (references === 'unknown' || references > 0) return { status: 'referenced', source };
      return {
        status: 'confirmation-required',
        source,
        confirmationToken: this.sign({
          projectId: session.projectId,
          sourceId: source.sourceId,
          sourceRevision: source.revision,
          catalogRevision: listed.catalogRevision,
          expiresAt: (this.options.now ?? Date.now)() + 60_000,
        }),
        impact: {
          activeJobCount: this.options.activeJobCount(source.sourceId),
          searchableBlockCount: source.eligibility.indexed,
        },
      };
    }
    const payload = this.verify(input.confirmationToken);
    if (
      !payload ||
      payload.projectId !== session.projectId ||
      payload.sourceId !== source.sourceId ||
      payload.sourceRevision !== source.revision ||
      payload.catalogRevision !== listed.catalogRevision
    )
      return { status: 'conflict', currentSource: source, catalogRevision: listed.catalogRevision };
    const references = await this.options.references.countReferences(session, input.sourceId);
    if (references === 'unknown' || references > 0) return { status: 'referenced', source };
    await this.options.supersedeSource(source.sourceId);
    const result = await this.options.repository.removePublishedSource(
      session,
      source.sourceId,
      source.revision,
    );
    if (result.status === 'removed')
      this.options.events.publish(
        {
          catalogRevision: result.catalogRevision,
          type: 'source-removed',
          source,
        },
        session.sessionId,
      );
    return result;
  }

  private sign(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }
  private verify(token: string): TokenPayload | null {
    try {
      const [body, provided, extra] = token.split('.');
      if (!body || !provided || extra) return null;
      const expected = createHmac('sha256', this.secret).update(body).digest();
      const actual = Buffer.from(provided, 'base64url');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
      if (payload.expiresAt < (this.options.now ?? Date.now)()) return null;
      return payload;
    } catch {
      return null;
    }
  }
}
