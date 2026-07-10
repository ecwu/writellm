import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, BookOpenCheck, CircleAlert, ExternalLink, LibraryBig } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { ChildrenViewHeader } from '../../layout/ChildrenViewHeader';
import type { ChildViewMode } from '../../app/types';
import type { CitationCoverageReport, FocusedWorkspaceState } from '../../../shared/types';

export function CitationCoverageView({
  state,
  mode,
  onModeChange,
  onCitationClick,
  onError
}: {
  state: FocusedWorkspaceState;
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
  onCitationClick: (publicRef: string) => void;
  onError: (message: string) => void;
}) {
  const [report, setReport] = useState<CitationCoverageReport | null>(null);

  useEffect(() => {
    let canceled = false;
    void getApi().getCitationCoverage().then((next) => {
      if (!canceled) {
        setReport(next);
      }
    }).catch((caught: unknown) => {
      if (!canceled) {
        onError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return () => {
      canceled = true;
    };
  }, [onError, state.nodes, state.knowledgeItems]);

  const sections = useMemo(() => report?.sections ?? [], [report]);
  const totalMentions = report?.sources.reduce((total, source) => total + source.citationCount, 0) ?? 0;
  const citedSources = report?.sources.filter((source) => source.citationCount > 0).length ?? 0;
  const unusedSources = report?.sources.filter((source) => source.citationCount === 0) ?? [];

  return (
    <section className="citation-coverage-view">
      <ChildrenViewHeader
        title="Evidence coverage"
        detail="Section-to-source citation usage"
        mode={mode}
        onModeChange={onModeChange}
      />
      {!report ? (
        <div className="citation-coverage-loading"><Spinner /> Loading citation coverage…</div>
      ) : (
        <div className="citation-coverage-content">
          <div className="citation-coverage-summary">
            <CoverageMetric icon={<BarChart3 />} label="Citation mentions" value={totalMentions} />
            <CoverageMetric icon={<BookOpenCheck />} label="Sources used" value={`${citedSources}/${report.sources.length}`} />
            <CoverageMetric icon={<LibraryBig />} label="Unused sources" value={unusedSources.length} />
          </div>
          <section className="citation-coverage-panel">
            <div className="citation-coverage-panel-header">
              <div>
                <h2>Section × source matrix</h2>
                <p>Each cell shows how many times a source is cited in a section.</p>
              </div>
            </div>
            {report.sources.length === 0 ? (
              <p className="citation-coverage-empty">Import and index sources to see their use in the manuscript.</p>
            ) : (
              <div className="citation-coverage-matrix-scroll">
                <table className="citation-coverage-matrix">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Total</th>
                      {sections.map((section) => <th key={section.sectionId}>{section.sectionTitle}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.sources.map((source) => {
                      const counts = new Map<string, number>();
                      sections.forEach((section) => {
                        const mention = section.sources.find((candidate) => candidate.itemId === source.itemId);
                        counts.set(section.sectionId, mention?.mentions ?? 0);
                      });
                      return (
                        <tr key={source.itemId} className={source.citationCount === 0 ? 'is-unused' : undefined}>
                          <td>
                            <div className="citation-coverage-source">
                              <strong>{source.itemTitle}</strong>
                              <span>{source.indexStatus}</span>
                            </div>
                          </td>
                          <td className="citation-coverage-total">{source.citationCount}</td>
                          {sections.map((section) => {
                            const count = counts.get(section.sectionId) ?? 0;
                            return (
                              <td key={section.sectionId}>
                                {count > 0 && source.representativePublicRef ? (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="citation-coverage-cell is-used"
                                    title={`Open ${source.itemTitle} in Knowledge`}
                                    onClick={() => onCitationClick(source.representativePublicRef!)}
                                  >
                                    {count}
                                  </Button>
                                ) : <span className="citation-coverage-cell">{count || '—'}</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="citation-coverage-panel">
            <div className="citation-coverage-panel-header">
              <div>
                <h2>Sources not yet used</h2>
                <p>These indexed sources have no citation in any section.</p>
              </div>
              {unusedSources.length > 0 ? <CircleAlert /> : null}
            </div>
            {unusedSources.length === 0 ? (
              <p className="citation-coverage-empty">Every indexed source is cited at least once.</p>
            ) : (
              <div className="citation-coverage-unused-list">
                {unusedSources.map((source) => (
                  <div key={source.itemId}>
                    <span>{source.itemTitle}</span>
                    {source.representativePublicRef ? (
                      <Button variant="ghost" size="sm" onClick={() => onCitationClick(source.representativePublicRef!)}>
                        Open <ExternalLink />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function CoverageMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return <div className="citation-coverage-metric"><span>{icon}</span><div><strong>{value}</strong><p>{label}</p></div></div>;
}
