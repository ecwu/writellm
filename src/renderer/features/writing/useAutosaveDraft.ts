import { useEffect, useRef, useState } from 'react';
import { getApi } from '../../api';
import type { ContentNodeRecord, FocusedWorkspaceState } from '../../../shared/types';

export type DraftSaveState = 'saved' | 'saving' | 'error';

export function useAutosaveDraft({
  contentNode,
  onState,
  onError
}: {
  contentNode: ContentNodeRecord;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(contentNode.content);
  const [saveState, setSaveState] = useState<DraftSaveState>('saved');
  const timerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef(contentNode.content);
  const lastSavedRef = useRef(contentNode.content);
  const contentRef = useRef(contentNode);
  const onStateRef = useRef(onState);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    contentRef.current = contentNode;
    onStateRef.current = onState;
    onErrorRef.current = onError;
  }, [contentNode, onState, onError]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    draftRef.current = contentNode.content;
    lastSavedRef.current = contentNode.content;
    setDraft(contentNode.content);
    setSaveState('saved');
  }, [contentNode.id]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (draftRef.current !== lastSavedRef.current) {
        void persistDraft(draftRef.current, true);
      }
    };
  }, []);

  function persistDraft(value: string, silent = false) {
    if (value === lastSavedRef.current) {
      return saveChainRef.current;
    }

    saveChainRef.current = saveChainRef.current.then(async () => {
      const content = contentRef.current;
      if (value === lastSavedRef.current) {
        return;
      }

      try {
        if (!silent) {
          setSaveState('saving');
        }
        const next = await getApi().updateNode(content.id, { content: value });
        lastSavedRef.current = value;
        onStateRef.current(next);
        if (!silent) {
          setSaveState(draftRef.current === value ? 'saved' : 'saving');
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!silent) {
          setSaveState(draftRef.current === value ? 'error' : 'saving');
          onErrorRef.current(message);
        }
      }
    });

    return saveChainRef.current;
  }

  function scheduleDraftSave(value: string) {
    setDraft(value);
    draftRef.current = value;
    setSaveState(value === lastSavedRef.current ? 'saved' : 'saving');

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persistDraft(value);
    }, 700);
  }

  async function flushPendingSave() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await persistDraft(draftRef.current);
  }

  return {
    draft,
    saveState,
    scheduleDraftSave,
    flushPendingSave
  };
}
