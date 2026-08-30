import { cloneElement, isValidElement, type ReactNode, useId } from 'react'
import type {
  CustomAgentPiApi,
  ProviderConfig,
  ProviderRole,
  ProviderSettingsSnapshot
} from '../../../../shared/contracts/providers'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export interface ProviderSettingsWorkspaceProps {
  role: ProviderRole
  snapshot: ProviderSettingsSnapshot
  closeAction: ReactNode
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
  onError: (message: string) => void
}

export const roleLabels: Record<ProviderRole, string> = {
  agent: 'Agent API',
  embedding: 'Embedding API',
  rerank: 'Reranking API',
  mineru: 'MinerU API',
  image: 'Image API'
}

export const customTransports: Array<{ value: CustomAgentPiApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'mistral-conversations', label: 'Mistral Conversations' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' }
]

export type SingletonProviderRole = Exclude<ProviderRole, 'agent' | 'image'>

export type SingletonProviderConfig = Extract<ProviderConfig, { role: SingletonProviderRole }>

export function SingletonConfigFields({
  role,
  config,
  setConfig,
  statusConfigured,
  apiKey,
  setApiKey
}: {
  role: SingletonProviderRole
  config: SingletonProviderConfig
  setConfig: (config: SingletonProviderConfig) => void
  statusConfigured: boolean
  apiKey: string
  setApiKey: (value: string) => void
}): React.JSX.Element {
  return (
    <FieldGroup>
      <ConfigField label='Base URL'>
        <Input
          value={config.baseUrl}
          autoComplete='url'
          placeholder='https://api.example.com/v1'
          onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
        />
      </ConfigField>
      <ConfigField label='Model ID'>
        <Input
          value={config.model}
          autoComplete='off'
          placeholder={role === 'mineru' ? 'vlm' : 'provider model ID'}
          onChange={(event) => setConfig({ ...config, model: event.target.value })}
        />
      </ConfigField>
      {config.role !== 'mineru' ? (
        <ConfigField label='Model revision'>
          <Input
            value={config.modelRevision}
            onChange={(event) => setConfig({ ...config, modelRevision: event.target.value })}
          />
        </ConfigField>
      ) : null}
      <ConfigField label='API key or token'>
        <Input
          type='password'
          value={apiKey}
          autoComplete='new-password'
          placeholder={statusConfigured ? 'Stored — enter a new value to replace' : 'Required'}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </ConfigField>
      <div className='grid gap-4 sm:grid-cols-2'>
        <ConfigField label='Request timeout (milliseconds)'>
          <Input
            type='number'
            min={1_000}
            max={300_000}
            value={config.timeoutMs}
            onChange={(event) => setConfig({ ...config, timeoutMs: Number(event.target.value) })}
          />
        </ConfigField>
        <ConfigField label='Batch limit'>
          <Input
            type='number'
            min={1}
            value={config.batchLimit}
            onChange={(event) => setConfig({ ...config, batchLimit: Number(event.target.value) })}
          />
        </ConfigField>
        {config.role === 'embedding' ? (
          <ConfigField label='Embedding dimensions'>
            <Input
              type='number'
              min={1}
              value={config.embeddingDimension}
              onChange={(event) =>
                setConfig({ ...config, embeddingDimension: Number(event.target.value) })
              }
            />
          </ConfigField>
        ) : null}
        {config.role === 'mineru' ? (
          <ConfigField label='File limit (MB)'>
            <Input
              type='number'
              min={1}
              max={200}
              value={config.fileSizeLimitMb ?? ''}
              onChange={(event) =>
                setConfig({ ...config, fileSizeLimitMb: Number(event.target.value) })
              }
            />
          </ConfigField>
        ) : null}
      </div>
    </FieldGroup>
  )
}

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
