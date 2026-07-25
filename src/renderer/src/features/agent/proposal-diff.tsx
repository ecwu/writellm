import { Columns2, Rows3 } from 'lucide-react'
import { useState } from 'react'
import ReactDiffViewer, {
  DiffMethod,
  type ReactDiffViewerStylesOverride
} from 'react-diff-viewer-continued'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const proposalDiffStyles: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: 'var(--background)',
      diffViewerTitleBackground: 'var(--muted)',
      diffViewerColor: 'var(--foreground)',
      diffViewerTitleColor: 'var(--foreground)',
      diffViewerTitleBorderColor: 'var(--border)',
      addedBackground: 'oklch(0.95 0.05 145)',
      removedBackground: 'oklch(0.96 0.04 25)',
      wordAddedBackground: 'oklch(0.83 0.12 145)',
      wordRemovedBackground: 'oklch(0.86 0.1 25)',
      gutterBackground: 'var(--muted)',
      gutterBackgroundDark: 'var(--muted)',
      codeFoldBackground: 'var(--muted)',
      codeFoldGutterBackground: 'var(--muted)'
    },
    dark: {
      diffViewerBackground: 'var(--background)',
      diffViewerTitleBackground: 'var(--muted)',
      diffViewerColor: 'var(--foreground)',
      diffViewerTitleColor: 'var(--foreground)',
      diffViewerTitleBorderColor: 'var(--border)',
      addedBackground: 'oklch(0.28 0.06 145)',
      removedBackground: 'oklch(0.29 0.06 25)',
      wordAddedBackground: 'oklch(0.4 0.12 145)',
      wordRemovedBackground: 'oklch(0.42 0.12 25)',
      gutterBackground: 'var(--muted)',
      gutterBackgroundDark: 'var(--muted)',
      codeFoldBackground: 'var(--muted)',
      codeFoldGutterBackground: 'var(--muted)'
    }
  },
  diffContainer: {
    width: '100%',
    minWidth: 0,
    fontSize: '0.75rem'
  },
  content: {
    width: '100%',
    minWidth: 0
  },
  line: {
    minWidth: 0
  },
  lineContent: {
    minWidth: 0
  },
  contentText: {
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  },
  titleBlock: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    padding: '0.5rem'
  }
}

export function ProposalDiff(props: {
  beforeText: string
  afterText: string
  beforeTextTruncated: boolean
  afterTextTruncated: boolean
  dark: boolean
}): React.JSX.Element {
  const [splitView, setSplitView] = useState(false)

  return (
    <section className='flex min-w-0 flex-col gap-2' aria-label='Proposal changes'>
      <div className='grid min-w-0 gap-2 @sm/agent:grid-cols-[minmax(0,1fr)_auto] @sm/agent:items-center'>
        <p className='text-xs font-medium text-muted-foreground'>Highlighted changes</p>
        <ToggleGroup
          type='single'
          size='sm'
          variant='outline'
          value={splitView ? 'split' : 'unified'}
          onValueChange={(value) => {
            if (value) setSplitView(value === 'split')
          }}
          className='grid w-full grid-cols-2 @sm/agent:w-auto'
          aria-label='Diff layout'
        >
          <ToggleGroupItem value='unified' aria-label='Unified'>
            <Rows3 /> Unified
          </ToggleGroupItem>
          <ToggleGroupItem value='split' aria-label='Split'>
            <Columns2 /> Split
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div
        className='max-h-80 max-w-full min-w-0 overflow-auto rounded-md border'
        data-testid='agent-proposal-diff'
        data-layout={splitView ? 'split' : 'unified'}
      >
        <ReactDiffViewer
          oldValue={props.beforeText || '—'}
          newValue={props.afterText || '—'}
          splitView={splitView}
          compareMethod={DiffMethod.WORDS_WITH_SPACE}
          showDiffOnly
          extraLinesSurroundingDiff={2}
          leftTitle={splitView ? 'Before' : 'Before → After'}
          rightTitle='After'
          useDarkTheme={props.dark}
          styles={proposalDiffStyles}
          disableWorker
          hideSummary
        />
      </div>
      {props.beforeTextTruncated || props.afterTextTruncated ? (
        <p className='text-xs text-muted-foreground'>
          Preview truncated to its safe display limit.
        </p>
      ) : null}
    </section>
  )
}
