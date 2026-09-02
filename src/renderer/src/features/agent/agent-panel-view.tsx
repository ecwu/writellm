import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowUp,
  ChevronDown,
  CircleStop,
  CornerDownRight,
  ListCollapse,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { AgentContextUsageIndicator } from './agent-context-usage-indicator'
import { AgentDetailsDialog } from './agent-details-dialog'
import {
  AgentAttentionDock,
  AgentErrorAlert,
  AgentQuestionnaireDock,
  ApprovalModePicker,
  ComposerAction,
  ComposerCommandMenu,
  ComposerContextChips,
  InteractionModePicker,
  ReviewBar,
  SkillMentionMenu
} from './agent-panel-controls'
import { ConversationSwitcher } from './agent-conversation-switcher'
import { EventTimeline } from './agent-event-timeline'
import { AgentModelEffortPicker } from './agent-model-effort-picker'
import { AgentModelRecovery } from './agent-model-recovery'
import { WritingTaskDialog, WritingTaskProgressDock } from './agent-writing-task'
import { isSectionProposalOutdated, writingSkillDegradationLabel } from './agent-view-model'
import { AgentAttentionBeam } from './agent-motion'
import { agentComposerKeyAction, agentComposerRunningAction } from './agent-panel-logic'
import type { AgentPanelController } from './use-agent-panel-controller'

export function AgentPanelView({
  controller
}: {
  controller: AgentPanelController
}): React.JSX.Element {
  const {
    props,
    sessions,
    events,
    runs,
    proposals,
    compactionConfirmOpen,
    setCompactionConfirmOpen,
    prompt,
    setPrompt,
    scopePreference,
    reviewFeedback,
    setReviewFeedback,
    composerAddOpen,
    setComposerAddOpen,
    setSlashMenuDismissed,
    setSlashSelectionIndex,
    setSkillMentionDismissed,
    setSkillMentionSelectionIndex,
    setComposerCaret,
    waitingMessagesOpen,
    setWaitingMessagesOpen,
    sessionSwitcherOpen,
    setSessionSwitcherOpen,
    detailsOpen,
    setDetailsOpen,
    taskEditorOpen,
    setTaskEditorOpen,
    continuationFailure,
    setContinuationFailure,
    titleGeneratingIds,
    loading,
    busy,
    pendingActionIds,
    error,
    providerCatalog,
    composerTextareaRef,
    activeSession,
    activeSessionArchived,
    activeRun,
    pendingQuestion,
    pendingMessages,
    choosingSkill,
    streaming,
    usage,
    usageDetails,
    latestRun,
    modelSelection,
    contextSnapshot,
    waitingProposal,
    workflowState,
    conversationLocked,
    canControlTask,
    modelReady,
    supportedThinkingLevels,
    availableModelPresets,
    effectiveRevisionIds,
    timeline,
    thinkingVisualState,
    headerStatus,
    beginNewConversation,
    setApprovalMode,
    setInteractionMode,
    setModelSelection,
    setThinkingLevel,
    openSession,
    regenerateTitle,
    archiveSession,
    compactSession,
    stopCompaction,
    canCompact,
    restoreSession,
    startRun,
    stopRun,
    answerUserQuestion,
    resumeWritingTask,
    reviseWritingTask,
    queueMessage,
    actOnPendingMessage,
    proposalAction,
    decideChangeSet,
    failedContinuationProposal,
    composerSettingsDisabled,
    interactionModeSwitchDisabled,
    composerCommands,
    slashCommands,
    slashSelectableCommands,
    slashCommandOpen,
    selectedSlashCommand,
    skillMentionCandidates,
    skillMentionSelectableCandidates,
    skillMentionOpen,
    selectedSkillMention,
    leadingSkillMentions,
    runComposerCommand,
    insertSkillMention,
    focusSkillMention
  } = controller
  const skillDegradationWarning = writingSkillDegradationLabel(latestRun)
  return (
    <>
      <aside
        className={
          props.open
            ? '@container/agent flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background'
            : 'hidden'
        }
        data-testid='agent-panel'
        aria-label='Writing agent side chat'
      >
        <header
          className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 border-b px-3 py-2'
          data-testid='agent-conversation-header'
        >
          <ConversationSwitcher
            open={sessionSwitcherOpen}
            onOpenChange={setSessionSwitcherOpen}
            sessions={sessions}
            activeSession={activeSession}
            titleGeneratingIds={titleGeneratingIds}
            busy={busy}
            status={headerStatus}
            workflowState={workflowState}
            thinkingVisualState={thinkingVisualState}
            onNew={beginNewConversation}
            onOpen={openSession}
            onArchive={archiveSession}
            onRestore={restoreSession}
            onRegenerateTitle={regenerateTitle}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Conversation actions'
                data-testid='agent-conversation-menu'
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                  <Settings2 /> Details
                </DropdownMenuItem>
                {!activeSessionArchived && activeSession ? (
                  <DropdownMenuItem
                    disabled={!canCompact}
                    onSelect={() => setCompactionConfirmOpen(true)}
                  >
                    <ListCollapse /> Summarize earlier conversation
                  </DropdownMenuItem>
                ) : null}
                {activeSessionArchived && activeSession ? (
                  <DropdownMenuItem onSelect={() => void restoreSession(activeSession)}>
                    <ArchiveRestore /> Restore
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Close writing agent'
            onClick={() => props.onOpenChange(false)}
          >
            <X />
          </Button>
        </header>

        <div className='min-h-0 flex-1'>
          {loading ? (
            <Marker role='status' className='p-4'>
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent>Loading conversation…</MarkerContent>
            </Marker>
          ) : activeSession === null ? (
            <div className='flex size-full items-center justify-center px-8 text-center text-sm text-muted-foreground'>
              Start with a request below. A conversation is created only when you send it.
            </div>
          ) : (
            <EventTimeline
              timeline={timeline}
              projectSessionId={props.projectSessionId}
              proposals={proposals}
              runs={runs}
              streaming={streaming}
              currentRevisionIds={effectiveRevisionIds}
              sectionTitles={props.sectionTitles}
              onProposalAction={proposalAction}
              onNew={beginNewConversation}
              busy={busy || activeSessionArchived}
            />
          )}
        </div>

        {activeSession?.writingTask ? (
          <WritingTaskProgressDock
            key={`${activeSession.agentSessionId}:${activeSession.writingTask.taskId}:${activeSessionArchived}`}
            task={activeSession.writingTask}
            projectSessionId={props.projectSessionId}
            proposals={proposals}
            currentRevisionIds={effectiveRevisionIds}
            sectionTitles={props.sectionTitles}
            canControl={canControlTask}
            busy={busy || activeSessionArchived}
            onEdit={() => setTaskEditorOpen(true)}
            onResume={resumeWritingTask}
            onBatch={decideChangeSet}
          />
        ) : null}

        <div
          className='flex min-w-0 shrink-0 flex-col gap-3 border-t px-4 py-3'
          data-testid='agent-composer'
        >
          {error ? (
            <AgentAttentionDock label='Agent error'>
              <AgentErrorAlert message={error} />
            </AgentAttentionDock>
          ) : null}
          {skillDegradationWarning === null ? null : (
            <AgentAttentionDock label='Writing Skill warning'>
              <Marker role='status'>
                <MarkerIcon>
                  <TriangleAlert />
                </MarkerIcon>
                <MarkerContent>{skillDegradationWarning}</MarkerContent>
              </Marker>
            </AgentAttentionDock>
          )}
          {activeSessionArchived && activeSession ? (
            <AgentAttentionDock label='Archived conversation'>
              <Marker role='status'>
                <MarkerIcon>
                  <Archive />
                </MarkerIcon>
                <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                  <span>Archived conversations are read only.</span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => void restoreSession(activeSession)}
                  >
                    <ArchiveRestore data-icon='inline-start' /> Restore
                  </Button>
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : pendingQuestion !== null ? (
            <AgentAttentionDock label='Agent clarification'>
              <AgentQuestionnaireDock
                key={pendingQuestion.toolCallId}
                pending={pendingQuestion}
                busy={busy || pendingQuestion.submitting}
                onSubmit={answerUserQuestion}
                onStop={stopRun}
              />
            </AgentAttentionDock>
          ) : waitingProposal !== undefined ? (
            <AgentAttentionDock label='Proposal review'>
              <AgentAttentionBeam attentionKey={waitingProposal.proposalId} paused={busy}>
                <ReviewBar
                  proposal={waitingProposal}
                  feedback={reviewFeedback}
                  busy={busy}
                  outdated={isSectionProposalOutdated(waitingProposal, effectiveRevisionIds)}
                  onFeedbackChange={setReviewFeedback}
                  onAction={proposalAction}
                />
              </AgentAttentionBeam>
            </AgentAttentionDock>
          ) : workflowState === 'generating' ? (
            <AgentAttentionDock label='Image generation'>
              <Marker role='status'>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent>
                  Generating an image. Review will appear here when it is ready.
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : workflowState === 'compacting' ? (
            <AgentAttentionDock label='Conversation summary'>
              <Marker role='status'>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                  <span>Summarizing earlier conversation…</span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => void stopCompaction()}
                  >
                    <CircleStop data-icon='inline-start' /> Stop
                  </Button>
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : continuationFailure !== null && failedContinuationProposal !== null ? (
            <AgentAttentionDock label='Continuation recovery'>
              <Marker role='alert'>
                <MarkerIcon>
                  <AlertCircle className='text-destructive' />
                </MarkerIcon>
                <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                  <span>
                    {continuationFailure.kind === 'approval'
                      ? 'Change applied, continuation failed'
                      : 'Feedback saved, revision failed'}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => {
                      if (continuationFailure.kind === 'approval') {
                        void startRun(
                          'Continue the requested writing task from the applied manuscript.',
                          failedContinuationProposal.proposalId,
                          false,
                          true,
                          failedContinuationProposal.agentRunId
                        ).then((started) => {
                          if (started) setContinuationFailure(null)
                        })
                      } else {
                        void startRun(
                          'Revise the rejected proposal from the stored review feedback.',
                          undefined,
                          false,
                          true,
                          failedContinuationProposal.agentRunId,
                          failedContinuationProposal.proposalId
                        ).then((started) => {
                          if (started) setContinuationFailure(null)
                        })
                      }
                    }}
                  >
                    <RotateCcw data-icon='inline-start' />
                    {continuationFailure.kind === 'approval' ? 'Continue task' : 'Retry revision'}
                  </Button>
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : !modelReady ? (
            <AgentModelRecovery
              presets={availableModelPresets}
              selection={modelSelection}
              activeConversation={activeSession !== null}
              disabled={busy || activeSessionArchived}
              onSelect={setModelSelection}
              onOpenSettings={props.onOpenSettings}
            />
          ) : (
            <Field data-disabled={busy || choosingSkill || activeSession?.compatible === false}>
              <FieldLabel htmlFor='agent-message' className='sr-only'>
                Agent message
              </FieldLabel>
              <ComposerContextChips
                scopePreference={scopePreference}
                skillMentions={leadingSkillMentions}
                annotationCount={props.includedAnnotations.length}
                disabled={composerSettingsDisabled}
                onScopeClick={() => setComposerAddOpen(true)}
                onSkillClick={focusSkillMention}
                onClearAnnotations={props.onClearIncludedAnnotations}
              />
              {activeRun !== null && pendingMessages.length > 0 ? (
                <Collapsible
                  open={waitingMessagesOpen}
                  onOpenChange={setWaitingMessagesOpen}
                  aria-label='Waiting messages'
                  className='group/waiting overflow-hidden rounded-md border bg-muted/20'
                  data-testid='agent-pending-messages'
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-9 w-full justify-start rounded-none px-2 text-muted-foreground'
                    >
                      <CornerDownRight />
                      <span className='min-w-0 flex-1 truncate text-left'>
                        Waiting follow-ups · {pendingMessages.length}
                      </span>
                      <ChevronDown className='transition-transform group-data-[state=open]/waiting:rotate-180 motion-reduce:transition-none' />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className='m-0 max-h-32 list-none overflow-y-auto border-t p-1'>
                      {pendingMessages.map((message) => {
                        const actionPending = pendingActionIds.has(message.pendingMessageId)
                        return (
                          <li
                            key={message.pendingMessageId}
                            className='flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-sm hover:bg-muted/60'
                          >
                            <span className='min-w-0 flex-1 truncate'>{message.content}</span>
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              className='h-7 shrink-0 px-2 text-muted-foreground'
                              disabled={actionPending}
                              onClick={() =>
                                void actOnPendingMessage(message.pendingMessageId, 'steer')
                              }
                            >
                              <CornerDownRight data-icon='inline-start' /> Steer
                            </Button>
                            <Button
                              type='button'
                              size='icon-xs'
                              variant='ghost'
                              className='shrink-0 text-muted-foreground hover:text-destructive'
                              aria-label='Delete waiting message'
                              disabled={actionPending}
                              onClick={() =>
                                void actOnPendingMessage(message.pendingMessageId, 'delete')
                              }
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <Popover
                open={slashCommandOpen || skillMentionOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setSlashMenuDismissed(true)
                    setSkillMentionDismissed(true)
                  }
                }}
              >
                <PopoverAnchor asChild>
                  <InputGroup
                    data-disabled={busy || choosingSkill || activeSession?.compatible === false}
                  >
                    <InputGroupTextarea
                      ref={composerTextareaRef}
                      id='agent-message'
                      value={prompt}
                      placeholder={
                        activeRun
                          ? choosingSkill
                            ? 'Loading writing guidance…'
                            : 'Queue a follow-up…'
                          : (activeSession?.interactionMode ?? 'write') === 'ask'
                            ? 'Ask about this manuscript…'
                            : (activeSession?.interactionMode ?? 'write') === 'plan'
                              ? 'Describe what you want to plan…'
                              : 'Describe the change you want…'
                      }
                      rows={2}
                      className='min-h-20 max-h-48 overflow-y-auto [field-sizing:content]'
                      disabled={busy || choosingSkill || activeSession?.compatible === false}
                      onChange={(event) => {
                        setPrompt(event.target.value)
                        setComposerCaret(event.target.selectionStart ?? event.target.value.length)
                        setSlashMenuDismissed(false)
                        setSlashSelectionIndex(0)
                        setSkillMentionDismissed(false)
                        setSkillMentionSelectionIndex(0)
                      }}
                      onSelect={(event) => {
                        setComposerCaret(event.currentTarget.selectionStart ?? prompt.length)
                      }}
                      onKeyDown={(event) => {
                        if (skillMentionOpen && !event.nativeEvent.isComposing) {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSkillMentionDismissed(true)
                            return
                          }
                          if (
                            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                            skillMentionSelectableCandidates.length > 0
                          ) {
                            event.preventDefault()
                            setSkillMentionSelectionIndex((current) =>
                              event.key === 'ArrowDown'
                                ? (current + 1) % skillMentionSelectableCandidates.length
                                : (current - 1 + skillMentionSelectableCandidates.length) %
                                  skillMentionSelectableCandidates.length
                            )
                            return
                          }
                          if (
                            (event.key === 'Enter' || event.key === 'Tab') &&
                            !event.shiftKey &&
                            selectedSkillMention !== null
                          ) {
                            event.preventDefault()
                            insertSkillMention(selectedSkillMention)
                            return
                          }
                        }
                        if (slashCommandOpen && !event.nativeEvent.isComposing) {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSlashMenuDismissed(true)
                            return
                          }
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault()
                            if (slashSelectableCommands.length === 0) return
                            setSlashSelectionIndex((current) =>
                              event.key === 'ArrowDown'
                                ? (current + 1) % slashSelectableCommands.length
                                : (current - 1 + slashSelectableCommands.length) %
                                  slashSelectableCommands.length
                            )
                            return
                          }
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            if (selectedSlashCommand !== null) {
                              runComposerCommand(selectedSlashCommand, true)
                            }
                            return
                          }
                        }
                        const action = agentComposerKeyAction({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          metaKey: event.metaKey,
                          ctrlKey: event.ctrlKey,
                          isComposing: event.nativeEvent.isComposing,
                          running: activeRun !== null
                        })
                        if (action === 'none' || action === 'newline') return
                        event.preventDefault()
                        if (action === 'steer') void queueMessage('steer')
                        else if (action === 'follow_up') void queueMessage('follow_up')
                        else void startRun(prompt)
                      }}
                    />
                    <InputGroupAddon align='block-end' className='justify-between gap-2'>
                      <div className='flex shrink-0 items-center gap-1'>
                        <Popover open={composerAddOpen} onOpenChange={setComposerAddOpen}>
                          <PopoverTrigger asChild>
                            <InputGroupButton
                              size='icon-sm'
                              aria-label='Add context'
                              disabled={composerSettingsDisabled}
                              data-testid='agent-add-menu-trigger'
                            >
                              <Plus />
                            </InputGroupButton>
                          </PopoverTrigger>
                          <PopoverContent align='start' side='top' className='w-80 p-0'>
                            <ComposerCommandMenu
                              commands={composerCommands}
                              onSelect={(command) => runComposerCommand(command, false)}
                            />
                          </PopoverContent>
                        </Popover>
                        <ApprovalModePicker
                          value={activeSession?.approvalMode ?? 'manual'}
                          disabled={
                            busy ||
                            activeSessionArchived ||
                            (activeSession?.interactionMode ?? 'write') !== 'write'
                          }
                          onSelect={setApprovalMode}
                        />
                      </div>
                      <div className='ml-auto flex min-w-0 flex-1 items-center justify-end gap-1'>
                        <AgentContextUsageIndicator snapshot={contextSnapshot} />
                        <AgentModelEffortPicker
                          presets={availableModelPresets}
                          selection={modelSelection}
                          levels={supportedThinkingLevels}
                          effort={
                            activeSession?.thinkingLevel ??
                            providerCatalog.defaultThinkingLevel ??
                            'medium'
                          }
                          disabled={composerSettingsDisabled}
                          onModelSelect={setModelSelection}
                          onEffortSelect={setThinkingLevel}
                        />
                        <InteractionModePicker
                          value={activeSession?.interactionMode ?? 'write'}
                          disabled={interactionModeSwitchDisabled}
                          onSelect={setInteractionMode}
                        />
                        {activeRun !== null ? (
                          agentComposerRunningAction(prompt) === 'follow_up' ? (
                            <InputGroupButton
                              variant='default'
                              size='icon-sm'
                              className='shrink-0 rounded-full'
                              aria-label='Queue follow-up'
                              title='Queue follow-up'
                              disabled={busy}
                              onClick={() => void queueMessage('follow_up')}
                            >
                              <ArrowUp />
                            </InputGroupButton>
                          ) : (
                            <ComposerAction
                              size='icon-sm'
                              variant='destructive'
                              className='shrink-0 rounded-full'
                              label='Stop'
                              disabled={busy}
                              onClick={() => void stopRun()}
                            >
                              <CircleStop />
                            </ComposerAction>
                          )
                        ) : (
                          <InputGroupButton
                            variant='default'
                            size='icon-sm'
                            className='shrink-0 rounded-full'
                            aria-label='Send'
                            title='Send'
                            disabled={
                              busy ||
                              prompt.trim().length === 0 ||
                              activeSession?.compatible === false
                            }
                            onClick={() => void startRun(prompt)}
                          >
                            <ArrowUp />
                          </InputGroupButton>
                        )}
                      </div>
                    </InputGroupAddon>
                  </InputGroup>
                </PopoverAnchor>
                <PopoverContent
                  align='start'
                  side='top'
                  className='w-[var(--radix-popover-trigger-width)] p-0'
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  data-testid={skillMentionOpen ? 'agent-skill-mention-menu' : 'agent-slash-menu'}
                >
                  {skillMentionOpen ? (
                    <SkillMentionMenu
                      candidates={skillMentionCandidates}
                      selectedId={selectedSkillMention?.skillId}
                      onSelectedIdChange={(id) => {
                        const index = skillMentionSelectableCandidates.findIndex(
                          (candidate) => candidate.skillId === id
                        )
                        if (index >= 0) setSkillMentionSelectionIndex(index)
                      }}
                      onSelect={insertSkillMention}
                    />
                  ) : (
                    <ComposerCommandMenu
                      commands={slashCommands}
                      selectedId={selectedSlashCommand?.id}
                      onSelectedIdChange={(id) => {
                        const index = slashSelectableCommands.findIndex(
                          (command) => command.id === id
                        )
                        if (index >= 0) setSlashSelectionIndex(index)
                      }}
                      onSelect={(command) => runComposerCommand(command, true)}
                    />
                  )}
                </PopoverContent>
              </Popover>
            </Field>
          )}
        </div>
      </aside>
      <AgentDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        session={activeSession}
        activeRun={activeRun}
        latestRun={latestRun}
        events={events}
        proposals={proposals}
        usage={usage}
        usageDetails={usageDetails}
        contextSnapshot={contextSnapshot}
        availableModelPresets={availableModelPresets}
        modelSelection={modelSelection}
        thinkingLevel={
          activeSession?.thinkingLevel ?? providerCatalog.defaultThinkingLevel ?? 'medium'
        }
        supportedThinkingLevels={supportedThinkingLevels}
        modelReady={modelReady}
        busy={busy || conversationLocked || activeRun !== null}
        onModelSelect={setModelSelection}
        onThinkingSelect={setThinkingLevel}
        onApprovalModeSelect={setApprovalMode}
      />
      <WritingTaskDialog
        open={taskEditorOpen}
        onOpenChange={setTaskEditorOpen}
        task={activeSession?.writingTask ?? null}
        busy={busy}
        onSave={reviseWritingTask}
      />
      <AlertDialog open={compactionConfirmOpen} onOpenChange={setCompactionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Summarize earlier conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an AI-generated, lossy context checkpoint for future replies. Original
              conversation events are kept and remain available in the timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void compactSession()}>
              {busy ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <ListCollapse data-icon='inline-start' />
              )}
              Summarize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
