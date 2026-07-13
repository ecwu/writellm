import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, PenLine, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TooltipTrigger } from '@/components/ui/tooltip';
import type {
  OutlineStatus,
  SaveOrientationInput,
  WritingOrientationApi,
} from '../../../shared/writing-orientation';
import type { WorkspaceLeaveGuard } from '../../workspace/WorkspaceShell';
import {
  applyDelete,
  applySave,
  content,
  createDraftItem,
  initializeOrientation,
  isDirty,
  itemId,
  markDraft,
  projectSectionNavigationItems,
  type OrientationState,
  updateMotivation,
} from './orientation-state';
import { moveItem } from './reorder';
import { SectionWorkspace } from './SectionWorkspace';

export function WritingOrientationPanel({
  api,
  onLeaveGuardChange,
  onStartWriting,
  onOpenLinkedChapter,
  workspace,
}: {
  api: WritingOrientationApi;
  onLeaveGuardChange?(guard: WorkspaceLeaveGuard): void;
  onStartWriting?(input: {
    outlineItemId: string;
    title: string;
    baseOrientationRevision: number;
  }): Promise<boolean>;
  onOpenLinkedChapter?(input: {
    chapterId: string;
    outlineItemId: string;
    title: string;
  }): Promise<void>;
  workspace?: {
    projectName: string;
    chapter?: { outlineItemId: string; node: ReactNode };
    onBack?(): void;
    onItemActivated?(): void;
  };
}) {
  const [state, setState] = useState<OrientationState | null>(null),
    [loadError, setLoadError] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingMutation = useRef<{ fingerprint: string; mutationId: string } | null>(null);
  useEffect(() => {
    let live = true;
    void api.load().then((result) => {
      if (!live) return;
      if (result.ok) setState(initializeOrientation(result.value));
      else setLoadError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [api]);
  const save = useCallback(async () => {
    const current = stateRef.current;
    if (!current || !isDirty(current) || current.saveState === 'saving')
      return { ok: true as const };
    const invalid = current.draft.outlineItems.find((item) => !item.title.trim());
    if (invalid) {
      setState({
        ...current,
        saveState: 'failed',
        lastError: {
          code: 'INVALID_INPUT',
          message: 'Outline titles cannot be blank.',
          retryable: false,
        },
      });
      return { ok: false as const, message: 'Fix the blank outline title before leaving.' };
    }
    const submitted = content(current.draft),
      fingerprint = `${current.baseline.revision}:${submitted}`;
    if (pendingMutation.current?.fingerprint !== fingerprint)
      pendingMutation.current = { fingerprint, mutationId: crypto.randomUUID() };
    const mutationId = pendingMutation.current.mutationId;
    setState({ ...current, saveState: 'saving', lastError: null });
    const input: SaveOrientationInput = {
      baseRevision: current.baseline.revision,
      mutationId,
      motivation: current.draft.motivation,
      outlineItems: current.draft.outlineItems.map((item) =>
        'outlineItemId' in item
          ? {
              outlineItemId: item.outlineItemId,
              title: item.title,
              summary: item.summary,
              status: item.status,
            }
          : {
              clientDraftId: item.clientDraftId,
              title: item.title,
              summary: item.summary,
              status: item.status,
            },
      ),
    };
    const result = await api.save(input);
    const latest = stateRef.current ?? current;
    if (result.ok) {
      pendingMutation.current = null;
      setState(applySave(latest, submitted, result.value));
      return { ok: true as const };
    }
    setState({ ...latest, saveState: 'failed', lastError: result.error });
    return { ok: false as const, message: result.error.message };
  }, [api]);
  useEffect(() => {
    if (!state || !onLeaveGuardChange) return;
    onLeaveGuardChange({
      ownerId: 'writing-orientation',
      dirty: isDirty(state),
      save,
      discard: () =>
        setState((current) => (current ? initializeOrientation(current.baseline) : current)),
    });
  }, [onLeaveGuardChange, save, state]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [save]);
  const selected = useMemo(
    () =>
      state?.draft.outlineItems.find((item) => itemId(item) === state.selectedOutlineItemId) ??
      null,
    [state],
  );
  if (loadError)
    return (
      <div role="alert">
        {loadError}{' '}
        <Button variant="secondary" onClick={() => location.reload()}>
          <RotateCcw aria-hidden="true" focusable="false" />
          Retry loading
        </Button>
      </div>
    );
  if (!state) return <p role="status">Loading writing orientation…</p>;
  const patchItem = (values: Partial<{ title: string; summary: string; status: OutlineStatus }>) =>
    setState(
      (current) =>
        current &&
        markDraft(current, {
          ...current.draft,
          outlineItems: current.draft.outlineItems.map((item) =>
            itemId(item) === current.selectedOutlineItemId ? { ...item, ...values } : item,
          ),
        }),
    );
  const reorder = (from: number, to: number) =>
    setState(
      (current) =>
        current &&
        markDraft(current, {
          ...current.draft,
          outlineItems: moveItem(current.draft.outlineItems, from, to),
        }),
    );
  const remove = async () => {
    if (!selected || !('outlineItemId' in selected)) {
      setState(
        (current) =>
          current &&
          markDraft(current, {
            ...current.draft,
            outlineItems: current.draft.outlineItems.filter((item) => item !== selected),
          }),
      );
      return;
    }
    const result = await api.deleteOutlineItem({
      outlineItemId: selected.outlineItemId,
      baseRevision: state.baseline.revision,
      mutationId: crypto.randomUUID(),
    });
    if (!result.ok) {
      setState({ ...state, saveState: 'failed', lastError: result.error });
      return;
    }
    setState((current) =>
      current ? applyDelete(current, selected.outlineItemId, result.value.document) : current,
    );
  };
  const startWriting = async () => {
    if (!selected || !('outlineItemId' in selected) || !onStartWriting) return;
    const opened = await onStartWriting({
      outlineItemId: selected.outlineItemId,
      title: selected.title,
      baseOrientationRevision: state.baseline.revision,
    });
    if (opened) {
      const loaded = await api.load();
      if (loaded.ok)
        setState({
          ...initializeOrientation(loaded.value),
          selectedOutlineItemId: selected.outlineItemId,
        });
    }
  };
  const panel = (
    <section
      className="orientation-panel mx-auto grid w-full max-w-5xl min-w-0 gap-6 p-6 text-xs"
      aria-labelledby="orientation-title"
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b pb-4">
        <h2 id="orientation-title" className="cn-font-heading text-base font-medium">
          Writing orientation
        </h2>
        <Button
          onClick={() => void save()}
          busy={state.saveState === 'saving'}
          disabled={!isDirty(state)}
        >
          <Save aria-hidden="true" focusable="false" />
          {state.saveState === 'saving' ? 'Saving…' : 'Save'}
        </Button>
        <span
          className="col-span-full text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {state.saveState === 'dirty'
            ? 'Unsaved changes'
            : state.saveState === 'failed'
              ? state.lastError?.message
              : state.saveState === 'saved'
                ? 'Saved'
                : 'Saving'}
        </span>
      </header>
      <fieldset className="grid min-w-0 gap-4 border-0 p-0">
        <legend className="mb-1 font-medium">Motivation</legend>
        {(
          [
            ['problem', 'Problem to solve'],
            ['targetReaders', 'Target readers'],
            ['desiredOutcome', 'Desired outcome'],
          ] as const
        ).map(([key, label]) => (
          <Label className="grid gap-2" key={key}>
            {label}
            <Textarea
              value={state.draft.motivation[key]}
              onChange={(event) => setState(updateMotivation(state, key, event.target.value))}
            />
          </Label>
        ))}
        {Object.values(state.draft.motivation).every((value) => !value) && (
          <p>Not filled in yet. Add context for your writing decisions.</p>
        )}
      </fieldset>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid content-start gap-3">
          <h3 className="font-medium">Outline</h3>
          <Button
            variant={state.draft.outlineItems.length === 0 ? 'default' : 'secondary'}
            onClick={() => setState(createDraftItem(state))}
          >
            <Plus aria-hidden="true" focusable="false" />
            Add outline item
          </Button>
          {state.draft.outlineItems.length === 0 ? (
            <p>No outline yet. Create your first section.</p>
          ) : (
            <ol className="m-0 grid list-none gap-1 p-0">
              {state.draft.outlineItems.map((item, index) => (
                <li
                  className="flex items-center gap-1"
                  key={itemId(item)}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    reorder(Number(event.dataTransfer.getData('text/plain')), index)
                  }
                >
                  <Button
                    className="flex-1 justify-start"
                    variant={state.selectedOutlineItemId === itemId(item) ? 'default' : 'ghost'}
                    aria-pressed={state.selectedOutlineItemId === itemId(item)}
                    onClick={() => setState({ ...state, selectedOutlineItemId: itemId(item) })}
                  >
                    {item.title || 'Untitled'} — {item.status}
                    {item.chapterRef ? ' — has chapter' : ''}
                  </Button>
                  <TooltipTrigger content={`Move ${item.title || 'Untitled'} up`}>
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label={`Move ${item.title} up`}
                      disabled={index === 0}
                      onClick={() => reorder(index, index - 1)}
                    >
                      <ArrowUp aria-hidden="true" focusable="false" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipTrigger content={`Move ${item.title || 'Untitled'} down`}>
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label={`Move ${item.title} down`}
                      disabled={index === state.draft.outlineItems.length - 1}
                      onClick={() => reorder(index, index + 1)}
                    >
                      <ArrowDown aria-hidden="true" focusable="false" />
                    </Button>
                  </TooltipTrigger>
                </li>
              ))}
            </ol>
          )}
        </div>
        <section className="grid content-start gap-4 p-4" aria-label="Outline item details">
          <h3 className="font-medium">Item details</h3>
          {selected ? (
            <>
              <Label className="grid gap-2">
                Title
                <Input
                  aria-invalid={!selected.title.trim()}
                  value={selected.title}
                  onChange={(event) => patchItem({ title: event.target.value })}
                />
              </Label>
              {!selected.title.trim() && <p role="alert">A title is required.</p>}
              <Label className="grid gap-2">
                Summary
                <Textarea
                  value={selected.summary}
                  onChange={(event) => patchItem({ summary: event.target.value })}
                />
              </Label>
              <Label className="grid gap-2">
                Status
                <Select
                  value={selected.status}
                  onValueChange={(value) => patchItem({ status: value as OutlineStatus })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not-started">Not started</SelectItem>
                    <SelectItem value="in-progress">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              {'outlineItemId' in selected && (
                <Button
                  disabled={isDirty(state) || !selected.title.trim()}
                  onClick={() => void startWriting()}
                >
                  <PenLine aria-hidden="true" focusable="false" />
                  {selected.chapterRef ? 'Continue writing' : 'Start writing'}
                </Button>
              )}
              {isDirty(state) && <p>Save outline changes before opening a chapter.</p>}
              <Button variant="destructive" onClick={() => void remove()}>
                <Trash2 aria-hidden="true" focusable="false" />
                {selected.chapterRef ? 'Chapter-linked item cannot be deleted' : 'Delete item'}
              </Button>
            </>
          ) : (
            <p>Select an item to edit its details.</p>
          )}
        </section>
      </div>
    </section>
  );
  if (!workspace) return panel;
  const sections = projectSectionNavigationItems(state);
  const chapterMatchesSelection =
    selected &&
    'outlineItemId' in selected &&
    selected.outlineItemId === workspace.chapter?.outlineItemId;
  return (
    <SectionWorkspace
      projectName={workspace.projectName}
      items={sections}
      selectedId={state.selectedOutlineItemId}
      onSelect={(selectedOutlineItemId) => {
        setState({ ...state, selectedOutlineItemId });
        workspace.onItemActivated?.();
        const item = state.draft.outlineItems.find(
          (candidate) => itemId(candidate) === selectedOutlineItemId,
        );
        if (item && 'outlineItemId' in item && item.chapterRef && onOpenLinkedChapter)
          void onOpenLinkedChapter({
            chapterId: item.chapterRef,
            outlineItemId: item.outlineItemId,
            title: item.title,
          });
      }}
      onAdd={() => setState(createDraftItem(state))}
      onBack={workspace.onBack}
    >
      {chapterMatchesSelection ? workspace.chapter?.node : panel}
    </SectionWorkspace>
  );
}
