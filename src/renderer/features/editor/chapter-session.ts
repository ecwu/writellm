import type { ChapterApi, ChapterDocument } from '../../../shared/chapters';
export type ChapterSessionState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  document?: ChapterDocument;
  created?: boolean;
  message?: string;
};
export async function openChapterSession(
  api: ChapterApi,
  input: { outlineItemId: string; baseOrientationRevision: number; mutationId: string },
): Promise<ChapterSessionState> {
  const result = await api.openForOutlineItem(input);
  return result.ok
    ? { status: 'ready', document: result.value.document, created: result.value.created }
    : { status: 'error', message: result.error.message };
}
