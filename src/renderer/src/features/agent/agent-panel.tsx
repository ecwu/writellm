import type { AgentQuickActionRequest } from '../../../../shared/contracts/agent-quick-actions'
import type { AgentPanelSelection } from './agent-panel-logic'
import { AgentPanelView } from './agent-panel-view'
import { useAgentPanelController } from './use-agent-panel-controller'

export type { AgentPanelSelection } from './agent-panel-logic'

export interface AgentPanelQuickActionRequest {
  requestId: string
  quickAction: AgentQuickActionRequest
  selection: AgentPanelSelection
}

export interface AgentPanelPromptRequest {
  requestId: string
  prompt: string
}

export interface AgentPanelProps {
  open: boolean
  onOpenChange(open: boolean): void
  onOpenSettings(): void
  projectSessionId: string
  activeSectionId: string | null
  sectionTitles: Readonly<Record<string, string>>
  currentRevisionIds: Readonly<Record<string, string>>
  selection: AgentPanelSelection | null
  quickActionRequest?: AgentPanelQuickActionRequest | null
  promptRequest?: AgentPanelPromptRequest | null
  onPromptHandled?(requestId: string, started: boolean): void
  onQuickActionHandled?(requestId: string, started: boolean): void
  onFollowSection(sectionId: string): Promise<boolean>
  flushCurrent(): Promise<boolean>
  refreshManuscript(): Promise<void>
  onError(message: string): void
}

export function AgentPanel(props: AgentPanelProps): React.JSX.Element {
  const controller = useAgentPanelController(props)
  return <AgentPanelView controller={controller} />
}
