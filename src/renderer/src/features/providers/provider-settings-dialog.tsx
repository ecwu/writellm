import { AgentProviderWorkspace } from './agent-provider-settings'
import { ImageProviderWorkspace } from './image-provider-settings'
import type { ProviderSettingsWorkspaceProps } from './provider-settings-common'
import { SingletonProviderWorkspace } from './singleton-provider-settings'

export function ProviderSettingsWorkspace(
  props: ProviderSettingsWorkspaceProps
): React.JSX.Element {
  if (props.role === 'agent') return <AgentProviderWorkspace {...props} />
  if (props.role === 'image') return <ImageProviderWorkspace {...props} />
  return <SingletonProviderWorkspace {...props} role={props.role} />
}
