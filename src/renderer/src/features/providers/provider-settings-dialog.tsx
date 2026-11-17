import { AgentProviderWorkspace } from './agent-provider-settings'
import { ImageProviderWorkspace } from './image-provider-settings'
import type { ProviderSettingsWorkspaceProps } from './provider-settings-common'
import { SpeechProviderWorkspace } from './speech-provider-settings'
import { SingletonProviderWorkspace } from './singleton-provider-settings'

export function ProviderSettingsWorkspace({
  initialAgentPresetId,
  ...props
}: ProviderSettingsWorkspaceProps & { initialAgentPresetId?: string }): React.JSX.Element {
  if (props.role === 'agent') {
    return <AgentProviderWorkspace {...props} initialPresetId={initialAgentPresetId} />
  }
  if (props.role === 'image') return <ImageProviderWorkspace {...props} />
  if (props.role === 'speech') return <SpeechProviderWorkspace {...props} />
  return <SingletonProviderWorkspace {...props} role={props.role} />
}
