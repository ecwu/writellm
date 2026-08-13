import type { AnnotationRecord } from '../../../../shared/contracts/annotations'
import type { ManuscriptWorkspace } from '../../../../shared/contracts/manuscript'
import type { ReviewIssueRecord } from '../../../../shared/contracts/review'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnnotationsPanel } from './annotations-panel'
import { ReviewIssuesPanel } from './review-issues-panel'

export function ReviewCenterPanel(props: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  onNavigateIssue(issue: ReviewIssueRecord): void
  onNavigateAnnotation(annotation: AnnotationRecord): void
  onIncludeAnnotations(annotations: AnnotationRecord[]): void
  onError(message: string): void
}): React.JSX.Element {
  return (
    <Tabs defaultValue='annotations' className='flex min-h-0 flex-1 flex-col'>
      <TabsList className='m-2 grid grid-cols-2'>
        <TabsTrigger value='annotations'>Annotations</TabsTrigger>
        <TabsTrigger value='issues'>Agent issues</TabsTrigger>
      </TabsList>
      <TabsContent value='annotations' className='min-h-0 flex-1 overflow-hidden'>
        <AnnotationsPanel
          projectSessionId={props.projectSessionId}
          workspace={props.workspace}
          onNavigate={props.onNavigateAnnotation}
          onIncludeAgent={props.onIncludeAnnotations}
          onError={props.onError}
        />
      </TabsContent>
      <TabsContent value='issues' className='min-h-0 flex-1 overflow-hidden'>
        <ReviewIssuesPanel
          projectSessionId={props.projectSessionId}
          workspace={props.workspace}
          onNavigate={props.onNavigateIssue}
          onError={props.onError}
        />
      </TabsContent>
    </Tabs>
  )
}
