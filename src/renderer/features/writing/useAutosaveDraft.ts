import { useEffect, useRef, useState } from 'react';
import { getApi } from '../../api';
import { sectionMarkdownForStorage } from '../../../shared/sectionMarkdown';
import type { FocusedWorkspaceState, SectionNodeRecord } from '../../../shared/types';

export type DraftSaveState = 'saved' | 'saving' | 'error';

export function useAutosaveDraft({
  section,
  onState,
  onError
}: {
  section: SectionNodeRecord;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(sectionMarkdownForStorage(section.markdownContent));
  const [saveState, setSaveState] = useState<DraftSaveState>('saved');
  const timerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef(sectionMarkdownForStorage(section.markdownContent));
  const lastSavedRef = useRef(sectionMarkdownForStorage(section.markdownContent));
  const sectionRef = useRef(section);
  const sectionIdRef = useRef(section.id);
  const sectionHashRef = useRef(section.markdownHash);
  const onStateRef = useRef(onState);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    sectionRef.current = section;
    onStateRef.current = onState;
    onErrorRef.current = onError;
  }, [section, onState, onError]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const nextDraft = sectionMarkdownForStorage(section.markdownContent);
    draftRef.current = nextDraft;
    lastSavedRef.current = nextDraft;
    sectionIdRef.current = section.id;
    sectionHashRef.current = section.markdownHash;
    setDraft(nextDraft);
    setSaveState('saved');
  }, [section.id]);

  useEffect(() => {
    if (section.id !== sectionIdRef.current) {
      return;
    }
    if (section.markdownHash === sectionHashRef.current) {
      return;
    }
    const nextDraft = sectionMarkdownForStorage(section.markdownContent);
    sectionHashRef.current = section.markdownHash;
    if (nextDraft === lastSavedRef.current) {
      return;
    }
    if (draftRef.current !== lastSavedRef.current) {
      lastSavedRef.current = nextDraft;
      return;
    }
    draftRef.current = nextDraft;
    lastSavedRef.current = nextDraft;
    setDraft(nextDraft);
    setSaveState('saved');
  }, [section.id, section.markdownContent, section.markdownHash]);

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
    const normalizedValue = sectionMarkdownForStorage(value);
    if (normalizedValue === lastSavedRef.current) {
      return saveChainRef.current;
    }

    saveChainRef.current = saveChainRef.current.then(async () => {
      const currentSection = sectionRef.current;
      if (normalizedValue === lastSavedRef.current) {
        return;
      }

      try {
        if (!silent) {
          setSaveState('saving');
        }
        const next = await getApi().updateSectionMarkdown(currentSection.id, normalizedValue);
        lastSavedRef.current = normalizedValue;
        onStateRef.current(next);
        if (!silent) {
          setSaveState(draftRef.current === normalizedValue ? 'saved' : 'saving');
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!silent) {
          setSaveState(draftRef.current === normalizedValue ? 'error' : 'saving');
          onErrorRef.current(message);
        }
      }
    });

    return saveChainRef.current;
  }

  function scheduleDraftSave(value: string) {
    const normalizedValue = sectionMarkdownForStorage(value);
    setDraft(normalizedValue);
    draftRef.current = normalizedValue;
    setSaveState(normalizedValue === lastSavedRef.current ? 'saved' : 'saving');

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persistDraft(normalizedValue);
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
