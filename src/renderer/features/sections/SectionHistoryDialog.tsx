import { useEffect, useMemo, useState } from 'react';
import { Diff, Hunk, parseDiff, type FileData } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { GitCompare, RotateCcw } from 'lucide-react';
import { getApi } from '../../api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '../../components/ui/item';
import type {
  FocusedWorkspaceState,
  GitHistoryRecord,
  SectionHistoryDetail,
  SectionNodeRecord
} from '../../../shared/types';

export function SectionHistoryDialog({
  open,
  section,
  onOpenChange,
  onState,
  onStatus,
  onError
}: {
  open: boolean;
  section: SectionNodeRecord | null;
  onOpenChange: (open: boolean) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [history, setHistory] = useState<GitHistoryRecord[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<SectionHistoryDetail | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<GitHistoryRecord | null>(null);

  const selectedEntry = useMemo(
    () => history.find((entry) => entry.hash === selectedHash) ?? null,
    [history, selectedHash]
  );
  const selectedIndex = selectedEntry
    ? history.findIndex((entry) => entry.hash === selectedEntry.hash)
    : -1;
  const parentEntry = historyDetail?.parentCommit ?? (selectedIndex >= 0 ? history[selectedIndex + 1] ?? null : null);
  const diffFiles = useMemo(() => parseHistoryDiff(historyDetail?.unifiedDiff ?? ''), [historyDetail?.unifiedDiff]);

  useEffect(() => {
    if (!open || !section) {
      setHistory([]);
      setSelectedHash(null);
      setHistoryDetail(null);
      setRestoreCandidate(null);
      return;
    }

    let canceled = false;
    setLoadingHistory(true);
    getApi()
      .listGitHistory(section.id)
      .then((entries) => {
        if (canceled) {
          return;
        }
        setHistory(entries);
        setSelectedHash(entries[0]?.hash ?? null);
      })
      .catch((caught) => {
        if (!canceled) {
          onError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingHistory(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [open, section?.id]);

  useEffect(() => {
    if (!open || !section || !selectedEntry) {
      setHistoryDetail(null);
      return;
    }

    let canceled = false;
    setLoadingDiff(true);
    getApi()
      .getSectionHistoryDetail(section.id, selectedEntry.hash)
      .then((detail) => {
        if (canceled) {
          return;
        }
        setHistoryDetail(detail);
      })
      .catch((caught) => {
        if (!canceled) {
          onError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoadingDiff(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [open, section?.id, selectedEntry?.hash]);

  async function restoreSelectedVersion(entry: GitHistoryRecord | null) {
    if (!section || !entry) {
      return;
    }

    try {
      setRestoring(true);
      const next = await getApi().restoreSectionVersion(section.id, entry.hash);
      onState(next);
      onStatus(`Restored ${section.title} to ${entry.shortHash}.`);
      onOpenChange(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoring(false);
      setRestoreCandidate(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="section-history-dialog">
        <DialogHeader>
          <DialogTitle>Section history</DialogTitle>
          <DialogDescription>
            {section ? `${section.title} · logical block range` : 'No section selected'}
          </DialogDescription>
        </DialogHeader>

        <div className="section-history-layout">
          <aside className="section-history-list" aria-label="Section checkpoints">
            {loadingHistory ? (
              <p className="section-history-empty">Loading history...</p>
            ) : history.length === 0 ? (
              <p className="section-history-empty">No checkpoints yet. Create a checkpoint to start section history.</p>
            ) : (
              <ItemGroup>
                {history.map((entry) => (
                  <Item
                    key={entry.hash}
                    variant="outline"
                    size="sm"
                    className="section-history-entry"
                    data-state={entry.hash === selectedHash ? 'selected' : undefined}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedHash(entry.hash)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedHash(entry.hash);
                      }
                    }}
                  >
                    <ItemContent>
                      <ItemTitle className="section-history-entry-subject">{entry.subject}</ItemTitle>
                      <ItemDescription className="section-history-entry-meta">
                        {entry.shortHash} · {formatHistoryDate(entry.authorDate)}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </aside>

          <section className="section-history-detail" aria-label="Checkpoint diff">
            <div className="section-history-detail-header">
              <div>
                <p>{selectedEntry ? selectedEntry.subject : 'No checkpoint selected'}</p>
                <span>
                  {selectedEntry
                    ? parentEntry
                      ? `${parentEntry.shortHash} -> ${selectedEntry.shortHash}`
                      : `${selectedEntry.shortHash} initial version`
                    : 'Select a checkpoint'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedEntry || restoring}
                onClick={() => setRestoreCandidate(selectedEntry)}
              >
                <RotateCcw />
                Restore this version
              </Button>
            </div>
            <div className="section-history-diff">
              {loadingDiff ? (
                <p className="section-history-empty">Loading diff...</p>
              ) : diffFiles.length > 0 ? (
                <VisualDiff files={diffFiles} />
              ) : (
                <div className="section-history-no-diff">
                  <GitCompare />
                  <p>No section text changes in this checkpoint.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
      <AlertDialog open={Boolean(restoreCandidate)} onOpenChange={(open) => {
        if (!open) {
          setRestoreCandidate(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore checkpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              Restore {section?.title ?? 'this section'} to checkpoint {restoreCandidate?.shortHash}. Current section Markdown will be replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={restoring}
              onClick={() => void restoreSelectedVersion(restoreCandidate)}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

function VisualDiff({ files }: { files: FileData[] }) {
  return (
    <div className="section-history-visual-diff">
      {files.map((file) => (
        <div key={`${file.oldRevision}:${file.newRevision}:${file.oldPath}:${file.newPath}`} className="section-history-diff-file">
          <div className="section-history-diff-file-header">
            <span>{file.newPath || file.oldPath}</span>
          </div>
          <Diff
            viewType="unified"
            diffType={file.type}
            hunks={file.hunks}
            gutterType="default"
            optimizeSelection
          >
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      ))}
    </div>
  );
}

function parseHistoryDiff(diff: string): FileData[] {
  if (!diff.trim()) {
    return [];
  }
  try {
    return parseDiff(diff, { nearbySequences: 'zip' }).filter((file) => file.hunks.length > 0);
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}
