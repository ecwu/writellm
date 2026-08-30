import { WritingWorkspaceView } from './writing-workspace-view'
import { useWritingWorkspaceController } from './use-writing-workspace-controller'

export type WritingWorkspaceProps = {
  projectSessionId: string
  projectName: string
  lifecycleState: string
  agentOpen: boolean
  onAgentOpenChange(open: boolean): void
  onOpenSettings(): void
  onError(message: string): void
}

export function WritingWorkspace(props: WritingWorkspaceProps): React.JSX.Element {
  const controller = useWritingWorkspaceController(props)
  return <WritingWorkspaceView props={props} controller={controller} />
}
