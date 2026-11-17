import { cloneElement, isValidElement, type ReactNode, useId } from 'react'
import type {
  CustomAgentPiApi,
  ProviderRole,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

export interface ProviderSettingsWorkspaceProps {
  role: ProviderRole
  snapshot: ProviderSettingsSnapshot
  closeAction: ReactNode
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
  onError: (message: string) => void
}

export const roleLabels: Record<ProviderRole, string> = {
  agent: 'Agent',
  embedding: 'Embedding',
  rerank: 'Reranking',
  mineru: 'Document Parsing',
  image: 'Image Generation',
  speech: 'Speech Input'
}

export const customTransports: Array<{ value: CustomAgentPiApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'mistral-conversations', label: 'Mistral Conversations' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' }
]

export function ConfigField({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactElement<{ id?: string }>
}): React.JSX.Element {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}
