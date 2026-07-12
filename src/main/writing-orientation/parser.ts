import { Buffer } from 'node:buffer';
import { isRecord } from '../../shared/project.js';
import { ORIENTATION_KIND, ORIENTATION_MAX_BYTES, ORIENTATION_SCHEMA_VERSION, type DeleteOutlineItemInput, type MotivationInput, type OrientationError, type OutlineItem, type OutlineItemSaveInput, type SaveOrientationInput, type WritingOrientationDocument } from '../../shared/writing-orientation.js';

export class OrientationValidationError extends Error { constructor(readonly detail: OrientationError) { super(detail.message); } }
const fail = (code: OrientationError['code'], message: string, retryable = false): never => { throw new OrientationValidationError({ code, message, retryable }); };
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const safeRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0');
const status = (value: unknown) => value === 'not-started' || value === 'in-progress' || value === 'completed';
function motivation(value: unknown): MotivationInput { if (!isRecord(value) || !exact(value, ['problem', 'targetReaders', 'desiredOutcome']) || !text(value.problem) || !text(value.targetReaders) || !text(value.desiredOutcome)) fail('INVALID_INPUT', 'Writing motivation contains invalid text.'); return value as MotivationInput; }
function ceiling(value: unknown): void { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > ORIENTATION_MAX_BYTES) fail('PAYLOAD_TOO_LARGE', 'Writing orientation exceeds the 2 MiB safety limit.'); }

export function emptyOrientation(projectId: string): WritingOrientationDocument { return { kind: ORIENTATION_KIND, schemaVersion: ORIENTATION_SCHEMA_VERSION, projectId, revision: 0, updatedAt: '', motivation: { problem: '', targetReaders: '', desiredOutcome: '' }, outlineItems: [] }; }
export function parseDiskDocument(value: unknown, projectId: string): WritingOrientationDocument {
  ceiling(value);
  if (!isRecord(value)) fail('STORAGE_READ_FAILED', 'Saved writing orientation is malformed.');
  const record = value as Record<string, unknown>;
  if (record.kind !== ORIENTATION_KIND || record.schemaVersion !== ORIENTATION_SCHEMA_VERSION) fail('UNSUPPORTED_SCHEMA', 'This writing orientation format is not supported.');
  if (!exact(record, ['kind', 'schemaVersion', 'projectId', 'revision', 'updatedAt', 'motivation', 'outlineItems']) || record.projectId !== projectId || !safeRevision(record.revision) || !text(record.updatedAt) || !Array.isArray(record.outlineItems)) fail('STORAGE_READ_FAILED', 'Saved writing orientation could not be verified.');
  const seen = new Set<string>(), chapters = new Set<string>();
  const items = (record.outlineItems as unknown[]).map((raw): OutlineItem => {
    if (!isRecord(raw)) fail('STORAGE_READ_FAILED', 'A saved outline item is invalid.');
    const item = raw as Record<string, unknown>;
    if (!exact(item, ['outlineItemId', 'title', 'summary', 'status', 'chapterRef']) || !uuid(item.outlineItemId) || !text(item.title) || !item.title.trim() || !text(item.summary) || !status(item.status) || !(item.chapterRef === null || uuid(item.chapterRef))) fail('STORAGE_READ_FAILED', 'A saved outline item is invalid.');
    if (seen.has(item.outlineItemId as string) || (item.chapterRef !== null && chapters.has(item.chapterRef as string))) fail('STORAGE_READ_FAILED', 'Saved outline identities are not unique.');
    seen.add(item.outlineItemId as string); if (item.chapterRef) chapters.add(item.chapterRef as string);
    return item as OutlineItem;
  });
  return { ...(record as Omit<WritingOrientationDocument, 'motivation' | 'outlineItems'>), motivation: motivation(record.motivation), outlineItems: items };
}
export function parseSaveInput(value: unknown, current: WritingOrientationDocument): SaveOrientationInput {
  ceiling(value);
  if (!isRecord(value) || !exact(value, ['baseRevision', 'mutationId', 'motivation', 'outlineItems']) || !safeRevision(value.baseRevision) || !uuid(value.mutationId) || !Array.isArray(value.outlineItems)) fail('INVALID_INPUT', 'Save request is invalid.');
  const record = value as Record<string, unknown>;
  const durable = new Set<string>(), drafts = new Set<string>();
  const items = (record.outlineItems as unknown[]).map((raw): OutlineItemSaveInput => {
    if (!isRecord(raw)) fail('INVALID_INPUT', 'Fix the highlighted outline title or fields.');
    const item = raw as Record<string, unknown>;
    if (!text(item.title) || !item.title.trim() || !text(item.summary) || !status(item.status) || 'chapterRef' in item) fail('INVALID_INPUT', 'Fix the highlighted outline title or fields.');
    const existing = 'outlineItemId' in item, fresh = 'clientDraftId' in item;
    if (existing === fresh || !exact(item, existing ? ['outlineItemId', 'title', 'summary', 'status'] : ['clientDraftId', 'title', 'summary', 'status'])) fail('INVALID_INPUT', 'Each outline item must have exactly one identity.');
    const id = existing ? item.outlineItemId : item.clientDraftId;
    if (!uuid(id) || (existing ? durable : drafts).has(id)) fail('INVALID_INPUT', 'Outline identities must be unique UUIDs.');
    (existing ? durable : drafts).add(id as string); return item as OutlineItemSaveInput;
  });
  const authoritative = new Set(current.outlineItems.map(item => item.outlineItemId));
  if (durable.size !== authoritative.size || [...durable].some(id => !authoritative.has(id))) fail('INVALID_INPUT', 'Existing outline items cannot be added or removed by save.');
  return { baseRevision: record.baseRevision as number, mutationId: record.mutationId as string, motivation: motivation(record.motivation), outlineItems: items };
}
export function parseDeleteInput(value: unknown): DeleteOutlineItemInput { ceiling(value); if (!isRecord(value) || !exact(value, ['outlineItemId', 'baseRevision', 'mutationId']) || !uuid(value.outlineItemId) || !uuid(value.mutationId) || !safeRevision(value.baseRevision)) fail('INVALID_INPUT', 'Delete request is invalid.'); return value as unknown as DeleteOutlineItemInput; }
