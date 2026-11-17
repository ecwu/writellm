import { AgentProviderWorkspace } from './agent-provider-settings'
import { ImageProviderWorkspace } from './image-provider-settings'
import type { ProviderSettingsWorkspaceProps } from './provider-settings-common'
import { PurposeProviderWorkspace } from './purpose-provider-settings'

export function ProviderSettingsWorkspace({
  initialAgentPresetId,
  ...props
}: ProviderSettingsWorkspaceProps & { initialAgentPresetId?: string }): React.JSX.Element {
  if (props.role === 'agent') {
    return <AgentProviderWorkspace {...props} initialPresetId={initialAgentPresetId} />
  }
  if (props.role === 'image') return <ImageProviderWorkspace {...props} />
  return <PurposeProviderWorkspace key={props.role} {...props} role={props.role} />
}
