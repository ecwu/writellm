import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  FileText,
  ImageIcon,
  ImageOff,
  ListTree,
  MoveRight,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type {
  MutationProposalRecord,
  ProposalPresentation as ProposalPresentationData,
  ProposalPresentationText
} from '../../../../shared/contracts/agent-mutations'
import type { WritingRule } from '../../../../shared/contracts/writing-rules'
import { ProposalDiff } from './proposal-diff'

const BRIEF_FIELD_LABELS: Record<
  Extract<ProposalPresentationData, { kind: 'brief_fields' }>['fields'][number]['field'],
  string
> = {
  title: 'Title',
  description: 'Description',
  topic: 'Topic',
  targetAudience: 'Target audience',
  language: 'Language',
  styleTone: 'Style and tone',
  scopeExclusions: 'Scope exclusions',
  targetLength: 'Target length',
  citationRequirements: 'Citation requirements',
  additionalInstructions: 'Additional instructions'
}

export function ProposalPresentation(props: {
  proposal: MutationProposalRecord
  projectSessionId: string
  sectionTitles: Readonly<Record<string, string>>
  dark: boolean
  compact?: boolean
}): React.JSX.Element {
  const presentation = props.proposal.payload.preview.presentation
  if (presentation?.kind === 'brief_fields') {
    return <BriefProposalView presentation={presentation} compact={props.compact} />
  }
  if (presentation?.kind === 'outline_operations') {
    return <OutlineProposalView presentation={presentation} compact={props.compact} />
  }
  if (presentation?.kind === 'writing_rules') {
    return <WritingRulesProposalView presentation={presentation} compact={props.compact} />
  }
  if (props.proposal.kind === 'generated_image_insert') {
    return (
      <GeneratedImageProposalView
        proposal={props.proposal}
        projectSessionId={props.projectSessionId}
        sectionTitles={props.sectionTitles}
        compact={props.compact}
      />
    )
  }
  if (props.proposal.kind === 'section_patch') {
    return <SectionProposalView proposal={props.proposal} dark={props.dark} />
  }
  return <LegacyProposalView proposal={props.proposal} dark={props.dark} />
}

function BriefProposalView(props: {
  presentation: Extract<ProposalPresentationData, { kind: 'brief_fields' }>
  compact?: boolean
}): React.JSX.Element {
  return (
    <section
      className='grid gap-2'
      aria-label='Brief field changes'
      data-testid='brief-proposal-view'
    >
      <p className='text-xs font-medium text-muted-foreground'>Changed brief fields</p>
      <div className='divide-y rounded-md border'>
        {props.presentation.fields.map((change) => (
          <FieldChange
            key={change.field}
            label={BRIEF_FIELD_LABELS[change.field]}
            before={change.before}
            after={change.after}
            compact={props.compact}
          />
        ))}
      </div>
    </section>
  )
}

function FieldChange(props: {
  label: string
  before: ProposalPresentationText
  after: ProposalPresentationText
  compact?: boolean
}): React.JSX.Element {
  return (
    <div className='grid min-w-0 gap-2 p-3 @sm/agent:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @sm/agent:items-start'>
      <div className='min-w-0'>
        <p className='mb-1 text-xs font-medium text-muted-foreground'>{props.label} · Before</p>
        <PresentationText value={props.before} compact={props.compact} />
      </div>
      <ArrowRight className='hidden size-4 text-muted-foreground @sm/agent:mt-5 @sm/agent:block' />
      <div className='min-w-0'>
        <p className='mb-1 text-xs font-medium text-muted-foreground'>{props.label} · After</p>
        <PresentationText value={props.after} compact={props.compact} />
      </div>
    </div>
  )
}

function PresentationText(props: {
  value: ProposalPresentationText
  compact?: boolean
}): React.JSX.Element {
  const empty = props.value.text === null || props.value.text.length === 0
  return (
    <div className='min-w-0'>
      <p
        className={cn(
          'whitespace-pre-wrap wrap-anywhere',
          empty && 'text-muted-foreground italic',
          props.compact && 'line-clamp-3'
        )}
      >
        {empty ? 'Not set' : props.value.text}
      </p>
      {props.value.truncated ? (
        <p className='mt-1 text-xs text-muted-foreground'>Preview truncated.</p>
      ) : null}
    </div>
  )
}

function OutlineProposalView(props: {
  presentation: Extract<ProposalPresentationData, { kind: 'outline_operations' }>
  compact?: boolean
}): React.JSX.Element {
  return (
    <section
      className='grid gap-2'
      aria-label='Outline operations'
      data-testid='outline-proposal-view'
    >
      <p className='text-xs font-medium text-muted-foreground'>Ordered outline operations</p>
      <ol className='divide-y rounded-md border'>
        {props.presentation.operations.map((operation, index) => (
          <li key={outlineOperationKey(operation)} className='p-3'>
            <div className='mb-2 flex min-w-0 items-start gap-2'>
              <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums'>
                {index + 1}
              </span>
              {outlineOperationIcon(operation.type)}
              <span className='min-w-0 flex-1 font-medium wrap-anywhere'>
                {outlineOperationTitle(operation)}
              </span>
              <Badge variant={operation.type === 'delete' ? 'warning' : 'outline'}>
                {operation.type}
              </Badge>
            </div>
            <div className='ml-12 grid gap-2 text-sm'>
              {operation.type === 'create' || operation.type === 'delete' ? (
                <>
                  <p className='text-muted-foreground'>
                    {outlineLocationLabel(operation.section.location)}
                  </p>
                  <p>
                    Status: <span className='capitalize'>{operation.section.status}</span>
                  </p>
                  {operation.section.objective.text ? (
                    <div>
                      <p className='text-xs font-medium text-muted-foreground'>Objective</p>
                      <PresentationText
                        value={operation.section.objective}
                        compact={props.compact}
                      />
                    </div>
                  ) : null}
                </>
              ) : operation.type === 'move' ? (
                <div className='grid gap-1 @sm/agent:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @sm/agent:items-center'>
                  <span>{outlineLocationLabel(operation.before)}</span>
                  <ArrowRight className='hidden size-4 text-muted-foreground @sm/agent:block' />
                  <span>{outlineLocationLabel(operation.after)}</span>
                </div>
              ) : (
                operation.changes.map((change) => (
                  <FieldChange
                    key={change.field}
                    label={outlineFieldLabel(change.field)}
                    before={change.before}
                    after={change.after}
                    compact={props.compact}
                  />
                ))
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function outlineOperationKey(
  operation: Extract<ProposalPresentationData, { kind: 'outline_operations' }>['operations'][number]
): string {
  return JSON.stringify(operation)
}

function outlineOperationTitle(
  operation: Extract<ProposalPresentationData, { kind: 'outline_operations' }>['operations'][number]
): string {
  const title =
    operation.type === 'create' || operation.type === 'delete'
      ? operation.section.title
      : operation.title
  if (operation.type === 'create') return `Create “${title}”`
  if (operation.type === 'delete') return `Delete “${title}”`
  if (operation.type === 'move') return `Move “${title}”`
  return `Update “${title}”`
}

function outlineOperationIcon(type: 'create' | 'update' | 'move' | 'delete'): React.JSX.Element {
  if (type === 'create') return <Plus className='mt-0.5 size-4 shrink-0 text-success' />
  if (type === 'delete') return <Trash2 className='mt-0.5 size-4 shrink-0 text-warning' />
  if (type === 'move') return <MoveRight className='mt-0.5 size-4 shrink-0' />
  return <Pencil className='mt-0.5 size-4 shrink-0' />
}

function outlineLocationLabel(location: { parentTitle: string | null; position: number }): string {
  return `${location.parentTitle === null ? 'Top level' : `Under “${location.parentTitle}”`} · position ${location.position + 1}`
}

function outlineFieldLabel(field: 'title' | 'objective' | 'status'): string {
  if (field === 'title') return 'Title'
  if (field === 'objective') return 'Objective'
  return 'Status'
}

function WritingRulesProposalView(props: {
  presentation: Extract<ProposalPresentationData, { kind: 'writing_rules' }>
  compact?: boolean
}): React.JSX.Element {
  return (
    <section
      className='grid gap-2'
      aria-label='Writing Rule changes'
      data-testid='writing-rules-proposal-view'
    >
      <p className='text-xs font-medium text-muted-foreground'>Writing Rule changes</p>
      <div className='divide-y rounded-md border'>
        {props.presentation.changes.map((change) => {
          const rule = change.after ?? change.before
          if (rule === null) return null
          return (
            <article key={change.ruleId} className='grid gap-2 p-3'>
              <div className='flex min-w-0 items-start gap-2'>
                <FileText className='mt-0.5 size-4 shrink-0' />
                <span className='min-w-0 flex-1 font-medium wrap-anywhere'>{rule.instruction}</span>
                <Badge variant={change.action === 'remove' ? 'warning' : 'outline'}>
                  {writingRuleActionLabel(change.action)}
                </Badge>
              </div>
              <WritingRuleDetail rule={rule} compact={props.compact} />
              {change.action === 'update' && change.before && change.after ? (
                <WritingRuleChangedFields before={change.before} after={change.after} />
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function WritingRuleDetail(props: { rule: WritingRule; compact?: boolean }): React.JSX.Element {
  return (
    <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs'>
      <dt className='text-muted-foreground'>Category</dt>
      <dd className='capitalize'>{props.rule.category}</dd>
      <dt className='text-muted-foreground'>State</dt>
      <dd>{props.rule.active ? 'Active' : 'Inactive'}</dd>
      {props.rule.preferredForm ? (
        <>
          <dt className='text-muted-foreground'>Prefer</dt>
          <dd className={cn('wrap-anywhere', props.compact && 'line-clamp-2')}>
            {props.rule.preferredForm}
          </dd>
        </>
      ) : null}
      {props.rule.discouragedForms.length > 0 ? (
        <>
          <dt className='text-muted-foreground'>Avoid</dt>
          <dd className={cn('wrap-anywhere', props.compact && 'line-clamp-2')}>
            {props.rule.discouragedForms.join(', ')}
          </dd>
        </>
      ) : null}
      {props.rule.rationale ? (
        <>
          <dt className='text-muted-foreground'>Rationale</dt>
          <dd className={cn('wrap-anywhere', props.compact && 'line-clamp-2')}>
            {props.rule.rationale}
          </dd>
        </>
      ) : null}
    </dl>
  )
}

function WritingRuleChangedFields(props: {
  before: WritingRule
  after: WritingRule
}): React.JSX.Element {
  const labels = [
    ['category', 'Category'],
    ['instruction', 'Instruction'],
    ['preferredForm', 'Preferred form'],
    ['discouragedForms', 'Discouraged forms'],
    ['rationale', 'Rationale'],
    ['active', 'State']
  ] as const
  const changed = labels.filter(
    ([field]) => JSON.stringify(props.before[field]) !== JSON.stringify(props.after[field])
  )
  return (
    <p className='text-xs text-muted-foreground'>
      Changed: {changed.map(([, label]) => label).join(', ')}
    </p>
  )
}

function writingRuleActionLabel(action: 'add' | 'update' | 'enable' | 'disable' | 'remove') {
  if (action === 'add') return 'Add'
  if (action === 'enable') return 'Enable'
  if (action === 'disable') return 'Disable'
  if (action === 'remove') return 'Remove'
  return 'Update'
}

function SectionProposalView(props: {
  proposal: MutationProposalRecord
  dark: boolean
}): React.JSX.Element {
  const preview = props.proposal.payload.preview
  return (
    <section
      className='grid gap-3'
      aria-label='Section changes'
      data-testid='section-proposal-view'
    >
      <div className='flex flex-wrap gap-1'>
        {props.proposal.payload.kind === 'section_patch'
          ? props.proposal.payload.mutation.operations.map((operation) => (
              <Badge key={JSON.stringify(operation)} variant='outline'>
                {sectionOperationLabel(operation.type)}
              </Badge>
            ))
          : null}
      </div>
      <ProposalDiff
        beforeText={preview.beforeText}
        afterText={preview.afterText}
        beforeTextTruncated={preview.beforeTextTruncated}
        afterTextTruncated={preview.afterTextTruncated}
        dark={props.dark}
      />
    </section>
  )
}

function sectionOperationLabel(type: string): string {
  const labels: Record<string, string> = {
    insertBlocks: 'Insert blocks',
    updateBlock: 'Update block',
    removeBlocks: 'Remove blocks',
    replaceBlocks: 'Replace blocks',
    moveBlocks: 'Move blocks'
  }
  return labels[type] ?? type.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function GeneratedImageProposalView(props: {
  proposal: MutationProposalRecord
  projectSessionId: string
  sectionTitles: Readonly<Record<string, string>>
  compact?: boolean
}): React.JSX.Element {
  const mutation =
    props.proposal.payload.kind === 'generated_image_insert'
      ? props.proposal.payload.mutation
      : null
  const preview = useQuery({
    queryKey: ['agent-proposal-image', props.projectSessionId, mutation?.assetId],
    queryFn: () =>
      window.desktop.editor.resolveAsset({
        projectSessionId: props.projectSessionId,
        assetId: mutation?.assetId ?? ''
      }),
    enabled: mutation?.assetId !== null && mutation?.assetId !== undefined,
    retry: false
  })
  if (mutation === null) return <LegacyProposalView proposal={props.proposal} dark={false} />
  const sectionTitle =
    props.sectionTitles[mutation.sectionId] ?? `Section ${mutation.sectionId.slice(0, 8)}`
  return (
    <section
      className='grid gap-3'
      aria-label='Generated image proposal'
      data-testid='image-proposal-view'
    >
      <figure className='overflow-hidden rounded-md border'>
        <div
          className={cn(
            'flex items-center justify-center bg-muted',
            props.compact ? 'max-h-48' : 'aspect-video'
          )}
        >
          {preview.data?.status === 'resolved' ? (
            <img
              className='size-full object-contain'
              src={preview.data.url}
              alt={mutation.altText}
            />
          ) : preview.isPending && mutation.assetId !== null ? (
            <Skeleton className='size-full min-h-32 rounded-none' />
          ) : (
            <ImageOff
              className='size-8 text-muted-foreground'
              aria-label='Image preview unavailable'
            />
          )}
        </div>
        <figcaption className='grid gap-1 p-3'>
          <span className='font-medium'>{mutation.altText}</span>
          {mutation.caption ? (
            <span className='text-sm text-muted-foreground'>{mutation.caption}</span>
          ) : null}
        </figcaption>
      </figure>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs'>
        <dt className='text-muted-foreground'>Destination</dt>
        <dd>{sectionTitle}</dd>
        <dt className='text-muted-foreground'>Placement</dt>
        <dd>
          {mutation.iteration?.disposition === 'replace'
            ? 'Replace source image'
            : mutation.placement.replace('_', ' ')}
        </dd>
        <dt className='text-muted-foreground'>Format</dt>
        <dd>
          {mutation.aspectRatio} · {mutation.imageSize}
        </dd>
      </dl>
      <details className='text-xs'>
        <summary className='cursor-pointer text-muted-foreground'>Generation prompt</summary>
        <p className='mt-2 whitespace-pre-wrap wrap-anywhere'>{mutation.prompt}</p>
      </details>
    </section>
  )
}

function LegacyProposalView(props: {
  proposal: MutationProposalRecord
  dark: boolean
}): React.JSX.Element {
  const preview = props.proposal.payload.preview
  return (
    <section
      className='grid gap-2'
      aria-label='Legacy proposal preview'
      data-testid='legacy-proposal-view'
    >
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        {props.proposal.kind === 'outline_patch' ? (
          <ListTree className='size-4' />
        ) : props.proposal.kind === 'brief_update' ? (
          <FileText className='size-4' />
        ) : (
          <ImageIcon className='size-4' />
        )}
        Legacy preview
      </div>
      <ProposalDiff
        beforeText={preview.beforeText}
        afterText={preview.afterText}
        beforeTextTruncated={preview.beforeTextTruncated}
        afterTextTruncated={preview.afterTextTruncated}
        dark={props.dark}
      />
    </section>
  )
}
