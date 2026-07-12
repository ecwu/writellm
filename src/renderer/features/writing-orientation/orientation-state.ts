import type { MotivationInput, OrientationError, OutlineItem, OutlineStatus, SaveOrientationValue, WritingOrientationDocument } from '../../../shared/writing-orientation';

export type DraftItem = OutlineItem | { clientDraftId: string; title: string; summary: string; status: OutlineStatus; chapterRef: null };
export type OrientationDraft = Omit<WritingOrientationDocument, 'outlineItems'> & { outlineItems: DraftItem[] };
export type OrientationState = { baseline: WritingOrientationDocument; draft: OrientationDraft; selectedOutlineItemId: string | null; saveState: 'saved' | 'dirty' | 'saving' | 'failed'; lastError: OrientationError | null };
export const itemId = (item: DraftItem) => 'outlineItemId' in item ? item.outlineItemId : item.clientDraftId;
export const content = (document: OrientationDraft | WritingOrientationDocument) => JSON.stringify({ motivation: document.motivation, outlineItems: document.outlineItems });
export const isDirty = (state: OrientationState) => content(state.draft) !== content(state.baseline);
export function initializeOrientation(document: WritingOrientationDocument): OrientationState { return { baseline: document, draft: structuredClone(document), selectedOutlineItemId: document.outlineItems[0]?.outlineItemId ?? null, saveState: 'saved', lastError: null }; }
export function markDraft(state: OrientationState, draft: OrientationDraft): OrientationState { return { ...state, draft, saveState: content(draft) === content(state.baseline) ? 'saved' : 'dirty', lastError: null }; }
export function createDraftItem(state: OrientationState, clientDraftId = crypto.randomUUID()): OrientationState { const item: DraftItem = { clientDraftId, title: 'Untitled section', summary: '', status: 'not-started', chapterRef: null }; const next = markDraft(state, { ...state.draft, outlineItems: [...state.draft.outlineItems, item] }); return { ...next, selectedOutlineItemId: clientDraftId }; }
export function applySave(state: OrientationState, submittedContent: string, value: SaveOrientationValue): OrientationState {
  const mapping = new Map(value.createdItemIds.map(pair => [pair.clientDraftId, pair.outlineItemId]));
  const draft = structuredClone(state.draft); draft.outlineItems = draft.outlineItems.map(item => 'clientDraftId' in item && mapping.has(item.clientDraftId) ? value.document.outlineItems.find(saved => saved.outlineItemId === mapping.get(item.clientDraftId))! : item);
  draft.revision = value.document.revision; draft.updatedAt = value.document.updatedAt;
  const selected = state.selectedOutlineItemId ? mapping.get(state.selectedOutlineItemId) ?? state.selectedOutlineItemId : value.document.outlineItems[0]?.outlineItemId ?? null;
  const unchanged = submittedContent === content(state.draft);
  return { baseline: value.document, draft: unchanged ? structuredClone(value.document) : draft, selectedOutlineItemId: selected, saveState: unchanged ? 'saved' : 'dirty', lastError: null };
}
export function updateMotivation(state: OrientationState, key: keyof MotivationInput, value: string) { return markDraft(state, { ...state.draft, motivation: { ...state.draft.motivation, [key]: value } }); }
