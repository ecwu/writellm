import { randomUUID } from 'node:crypto';
import { emptyOrientation } from '../../../src/main/writing-orientation/parser';
export const projectId = randomUUID(); export const outlineItemId = randomUUID(); export const mutationId = randomUUID();
export const emptyDocument = () => emptyOrientation(projectId);
export const savedDocument = () => ({ ...emptyDocument(), revision: 1, updatedAt: '2026-07-12T00:00:00.000Z', outlineItems: [{ outlineItemId, title: 'Opening', summary: '', status: 'not-started' as const, chapterRef: null }] });
