import { ManuscriptFindPanel } from './manuscript-find-panel'
import type { ManuscriptFindController } from './use-manuscript-find'

export function ManuscriptFindFeature({
  find,
  checkpointAvailable
}: {
  find: ManuscriptFindController
  checkpointAvailable: boolean
}) {
  return (
    <ManuscriptFindPanel
      query={find.findQuery}
      onQueryChange={find.changeFindQuery}
      caseSensitive={find.findCaseSensitive}
      onCaseSensitiveChange={find.changeFindCaseSensitive}
      scope={find.findScope}
      onScopeChange={find.changeFindScope}
      statuses={find.findStatuses}
      onStatusesChange={find.changeFindStatuses}
      result={find.findResult}
      loading={find.findLoading}
      loadingMore={find.findLoadingMore}
      error={find.findError}
      selectedMatchId={find.selectedFindMatchId}
      onActivate={(hit) => void find.activateFindHit(hit)}
      onLoadMore={() => {
        if (find.findResult?.nextCursor) void find.runFind(find.findResult.nextCursor)
      }}
      replaceOpen={find.replaceOpen}
      onReplaceOpenChange={find.changeReplaceOpen}
      replacement={find.replacement}
      onReplacementChange={find.changeReplacement}
      replacementPlan={find.replacementPlan}
      replacementCandidates={find.replacementCandidates}
      selectedCandidateIds={find.selectedReplacementIds}
      onCandidatesChecked={find.changeCandidates}
      onReviewReplacements={() => void find.reviewReplacements()}
      onLoadMoreReplacements={() => void find.loadMoreReplacements()}
      onApplyReplacements={() => void find.applyReplacements()}
      onUndoReplacement={() => void find.undoReplacement()}
      canUndoReplacement={find.replacementUndoCapabilities.length > 0}
      checkpointAvailable={checkpointAvailable}
      createCheckpoint={find.createReplacementCheckpoint}
      onCreateCheckpointChange={find.changeCheckpoint}
      replacementLoading={find.replacementLoading}
      replacementLoadingMore={find.replacementLoadingMore}
      replacementApplying={find.replacementApplying}
      replacementMessage={find.replacementMessage}
    />
  )
}
