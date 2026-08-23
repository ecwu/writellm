import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Braces,
  Check,
  FileSearch,
  FolderOpen,
  FolderPlus,
  KeyRound,
  LibraryBig,
  ListFilter,
  NotebookPen,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import type { OnboardingState, OnboardingStep } from '../../../../shared/contracts/app'
import type { ProjectTemplateSummary } from '../../../../shared/contracts/project-templates'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { ProjectCreationFields } from '@/features/project/project-creation-fields'
import { ProviderSettingsWorkspace } from '@/features/providers/provider-settings-dialog'
import { cn } from '@/lib/utils'

type PendingOnboardingState = Extract<OnboardingState, { status: 'pending' }>

interface OnboardingFlowProps {
  state: PendingOnboardingState
  projectName: string
  projectNameError: string | null
  projectTemplates: ProjectTemplateSummary[]
  selectedTemplateId: string
  creatingProject: boolean
  onStateChange: (state: OnboardingState) => Promise<void>
  onProjectNameChange: (name: string) => void
  onTemplateChange: (templateId: string) => void
  onDeleteSelectedTemplate: () => void
  onCreateProject: () => Promise<void>
  onOpenProject: () => Promise<void>
  onError: (message: string) => void
}

const onboardingSteps: Array<{
  id: OnboardingStep
  label: string
  description: string
  icon: typeof Sparkles
}> = [
  {
    id: 'welcome',
    label: 'Welcome',
    description: 'A quick, optional setup',
    icon: Sparkles
  },
  {
    id: 'agent',
    label: 'Agent LLM',
    description: 'Draft and revise with you',
    icon: Bot
  },
  {
    id: 'embedding',
    label: 'Embedding',
    description: 'Index your source library',
    icon: Braces
  },
  {
    id: 'rerank',
    label: 'Reranking',
    description: 'Prioritize useful evidence',
    icon: ListFilter
  },
  {
    id: 'mineru',
    label: 'MinerU',
    description: 'Parse complex documents',
    icon: KeyRound
  },
  {
    id: 'project',
    label: 'First project',
    description: 'Create a writing workspace',
    icon: FolderPlus
  }
]

const providerSteps: Partial<Record<OnboardingStep, ProviderRole>> = {
  agent: 'agent',
  embedding: 'embedding',
  rerank: 'rerank',
  mineru: 'mineru'
}

export function OnboardingFlow(props: OnboardingFlowProps): React.JSX.Element {
  const [providerSnapshot, setProviderSnapshot] = useState<ProviderSettingsSnapshot | null>(null)
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null)
  const stepIndex = onboardingSteps.findIndex((step) => step.id === props.state.step)
  const step = onboardingSteps[stepIndex] ?? onboardingSteps[0]
  const providerRole = providerSteps[step.id]
  const providerReady = providerSnapshot ? isProviderReady(providerSnapshot, providerRole) : false

  useEffect(() => {
    let current = true
    void window.desktop.providers
      .snapshot()
      .then((snapshot) => {
        if (!current) return
        setProviderSnapshot(snapshot)
        setProviderLoadError(null)
      })
      .catch((error: unknown) => {
        if (!current) return
        reportOnboardingError('onboarding provider snapshot', error)
        setProviderLoadError(
          'Provider settings could not be loaded. You can skip this step and configure them later.'
        )
      })
    return () => {
      current = false
    }
  }, [])

  const moveTo = async (nextStep: OnboardingStep): Promise<void> => {
    await props.onStateChange({ schemaVersion: 1, status: 'pending', step: nextStep })
  }

  const complete = async (): Promise<void> => {
    await props.onStateChange({ schemaVersion: 1, status: 'completed' })
  }

  const moveBack = (): void => {
    const previous = onboardingSteps[Math.max(0, stepIndex - 1)]
    void moveTo(previous.id)
  }

  const moveForward = (): void => {
    const next = onboardingSteps[Math.min(onboardingSteps.length - 1, stepIndex + 1)]
    void moveTo(next.id)
  }

  return (
    <main
      className='grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[16rem_minmax(0,1fr)]'
      aria-label='WriteLLM first-run setup'
      data-testid='onboarding-flow'
    >
      <aside className='hidden min-h-0 flex-col border-r bg-muted/30 lg:flex'>
        <div className='flex items-center gap-3 border-b p-5'>
          <div className='flex size-9 shrink-0 items-center justify-center rounded-md border bg-background'>
            <NotebookPen className='size-5' />
          </div>
          <div className='min-w-0'>
            <h1 className='font-semibold'>Set up WriteLLM</h1>
            <p className='text-xs text-muted-foreground'>
              About 3 minutes · everything is optional
            </p>
          </div>
        </div>

        <ScrollArea className='min-h-0 flex-1'>
          <nav className='flex flex-col gap-1 p-3' aria-label='Onboarding steps'>
            {onboardingSteps.map((candidate, index) => {
              const ready = providerSnapshot
                ? isProviderReady(providerSnapshot, providerSteps[candidate.id])
                : false
              const Icon = candidate.icon
              const isCurrent = candidate.id === step.id
              return (
                <Button
                  key={candidate.id}
                  type='button'
                  variant={isCurrent ? 'secondary' : 'ghost'}
                  className='h-auto min-w-0 justify-start px-3 py-2 text-left'
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => void moveTo(candidate.id)}
                >
                  <Icon data-icon='inline-start' />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{candidate.label}</span>
                    <span className='block truncate text-xs font-normal text-muted-foreground'>
                      {candidate.description}
                    </span>
                  </span>
                  {ready ? (
                    <Check aria-label={`${candidate.label} ready`} />
                  ) : (
                    <span className='text-xs tabular-nums text-muted-foreground'>{index + 1}</span>
                  )}
                </Button>
              )
            })}
          </nav>
        </ScrollArea>

        <div className='border-t p-4 text-xs leading-relaxed text-muted-foreground'>
          Credentials are encrypted by Electron Main. Project content stays inside its portable
          folder.
        </div>
      </aside>

      <section className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
        <header className='flex shrink-0 flex-col gap-2 border-b px-4 py-3 lg:hidden'>
          <div className='flex items-center justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate font-medium'>{step.label}</p>
              <p className='text-xs text-muted-foreground'>
                Step {stepIndex + 1} of {onboardingSteps.length}
              </p>
            </div>
            {providerReady ? <Badge>Ready</Badge> : <Badge variant='secondary'>Optional</Badge>}
          </div>
          <Progress
            value={((stepIndex + 1) / onboardingSteps.length) * 100}
            aria-label={`Onboarding step ${stepIndex + 1} of ${onboardingSteps.length}`}
          />
        </header>

        <div className='min-h-0 flex-1 overflow-hidden'>
          {step.id === 'welcome' ? (
            <WelcomeStep />
          ) : step.id === 'project' ? (
            <ProjectStep {...props} />
          ) : providerRole && providerSnapshot ? (
            <ProviderSettingsWorkspace
              role={providerRole}
              snapshot={providerSnapshot}
              closeAction={null}
              onSnapshotChange={setProviderSnapshot}
              onError={props.onError}
            />
          ) : providerLoadError ? (
            <div className='mx-auto flex h-full w-full max-w-3xl items-center p-6'>
              <Alert variant='destructive'>
                <FileSearch />
                <AlertTitle>Provider settings unavailable</AlertTitle>
                <AlertDescription>{providerLoadError}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
              <Spinner /> Loading provider settings…
            </div>
          )}
        </div>

        <footer className='flex shrink-0 flex-wrap items-center gap-2 border-t bg-background px-4 py-3 sm:px-6'>
          {stepIndex > 0 ? (
            <Button type='button' variant='outline' onClick={moveBack}>
              <ArrowLeft data-icon='inline-start' /> Back
            </Button>
          ) : (
            <Button type='button' variant='ghost' onClick={() => void complete()}>
              Skip setup
            </Button>
          )}

          {step.id === 'welcome' ? (
            <Button type='button' className='ml-auto' onClick={moveForward}>
              Start setup <ArrowRight data-icon='inline-end' />
            </Button>
          ) : step.id === 'project' ? (
            <>
              <Button
                type='button'
                variant='ghost'
                className='sm:ml-auto'
                disabled={props.creatingProject}
                onClick={() => void complete()}
              >
                Maybe later
              </Button>
              <Button type='submit' form='onboarding-project-form' disabled={props.creatingProject}>
                {props.creatingProject ? (
                  <Spinner data-icon='inline-start' />
                ) : (
                  <FolderPlus data-icon='inline-start' />
                )}
                {props.creatingProject ? 'Creating…' : 'Choose location & create'}
              </Button>
            </>
          ) : (
            <Button type='button' className='ml-auto' onClick={moveForward}>
              {providerReady ? 'Continue' : 'Skip for now'}
              <ArrowRight data-icon='inline-end' />
            </Button>
          )}
        </footer>
      </section>
    </main>
  )
}

function WelcomeStep(): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-8 p-6 sm:p-10'>
        <div className='flex max-w-2xl flex-col gap-3'>
          <h2 className='text-3xl font-semibold tracking-tight text-balance sm:text-4xl'>
            Set up WriteLLM around the way you write
          </h2>
          <p className='max-w-[68ch] text-base leading-relaxed text-muted-foreground sm:text-lg'>
            Connect only the services you want, then create a real writing project. Every choice is
            optional and stays editable in Settings.
          </p>
        </div>

        <ItemGroup className='border-y'>
          <Item className='px-0'>
            <ItemMedia variant='icon'>
              <Bot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Reviewable Agent changes</ItemTitle>
              <ItemDescription>
                The Agent drafts proposals. You decide what reaches the manuscript.
              </ItemDescription>
            </ItemContent>
          </Item>
          <ItemSeparator />
          <Item className='px-0'>
            <ItemMedia variant='icon'>
              <LibraryBig />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Searchable source material</ItemTitle>
              <ItemDescription>
                Embedding, reranking, and MinerU are separate so you can use only what your research
                needs.
              </ItemDescription>
            </ItemContent>
          </Item>
          <ItemSeparator />
          <Item className='px-0'>
            <ItemMedia variant='icon'>
              <FolderPlus />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>A portable project from the start</ItemTitle>
              <ItemDescription>
                Your manuscript, sources, and project history live together in one `.writellm`
                folder.
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>

        <Alert>
          <ShieldCheck />
          <AlertTitle>Local-first by design</AlertTitle>
          <AlertDescription>
            WriteLLM does not send content anywhere until you configure and use a provider-backed
            feature.
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  )
}

function ProjectStep(props: OnboardingFlowProps): React.JSX.Element {
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-8 p-6 sm:p-10'>
        <div className='flex flex-col gap-3'>
          <div className='flex size-11 items-center justify-center rounded-md border bg-muted/50'>
            <FolderPlus className='size-5' />
          </div>
          <h2 className='text-3xl font-semibold tracking-tight text-balance'>
            Create your first writing project
          </h2>
          <p className='max-w-[68ch] leading-relaxed text-muted-foreground'>
            Give the project a name and choose a starting point. The next action opens a native
            folder picker, then WriteLLM creates the portable project inside that location.
          </p>
        </div>

        <form
          id='onboarding-project-form'
          className='flex flex-col gap-6'
          onSubmit={(event) => {
            event.preventDefault()
            void props.onCreateProject()
          }}
        >
          <ProjectCreationFields
            idPrefix='onboarding'
            projectName={props.projectName}
            projectNameError={props.projectNameError}
            projectTemplates={props.projectTemplates}
            selectedTemplateId={props.selectedTemplateId}
            autoFocus
            onProjectNameChange={props.onProjectNameChange}
            onTemplateChange={props.onTemplateChange}
            onDeleteSelectedTemplate={props.onDeleteSelectedTemplate}
          />
        </form>

        <div className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
          <span>Already have a WriteLLM project?</span>
          <Button
            type='button'
            variant='link'
            className={cn('h-auto p-0', props.creatingProject && 'pointer-events-none opacity-50')}
            disabled={props.creatingProject}
            onClick={() => void props.onOpenProject()}
          >
            <FolderOpen data-icon='inline-start' /> Open an existing project
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}

function reportOnboardingError(source: string, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  window.desktop.diagnostics.reportRendererError({
    event: 'renderer.error',
    message: normalized.message,
    stack: normalized.stack,
    source
  })
}

function isProviderReady(
  snapshot: ProviderSettingsSnapshot,
  role: ProviderRole | undefined
): boolean {
  if (role === undefined) return false
  if (role === 'agent') {
    return snapshot.agentCatalog.presets.some(
      (preset) =>
        preset.enabled && preset.authConfigured && preset.models.some((model) => model.enabled)
    )
  }
  return snapshot.providers.find((provider) => provider.role === role)?.available === true
}
