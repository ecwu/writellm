import { LayoutList } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingsPageHeader } from '@/components/settings-page-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { reportRendererOperationError } from '@/diagnostics'
import { purposeDefault, purposeModelLabel } from '@/features/providers/purpose-model-label'
import { roleLabels } from '@/features/providers/provider-settings-common'
import { rendererQueryKeys } from '@/lib/query-keys'
import type { ProviderSettingsSnapshot } from '../../../shared/contracts/providers'
import type { AutocompleteSettings } from '../../../shared/contracts/autocomplete'

import { ProviderLogo } from './provider-logo'
import { AvatarGroup, AvatarGroupCount } from './ui/avatar'
import { imageSourceLogoId } from '@/features/providers/image-source-logo'
import { resolveModelsDevProviderLogoId } from '../../../shared/models-dev-provider-logos'

interface ProviderAvatar {
  name: string
  logoId: string | null
}

function ProviderAvatars({ providers }: { providers: ProviderAvatar[] }) {
  const unique = new Map<string, ProviderAvatar>()
  for (const provider of providers) {
    const key = provider.logoId ?? provider.name
    if (!unique.has(key)) unique.set(key, provider)
  }
  const avatars = [...unique.values()]
  if (!avatars.length) return null
  const names = avatars.map((avatar) => avatar.name).join(', ')
  return (
    <AvatarGroup role='img' aria-label={names} title={names}>
      {avatars.slice(0, 4).map((avatar) => (
        <ProviderLogo key={avatar.logoId ?? avatar.name} {...avatar} size='sm' />
      ))}
      {avatars.length > 4 && <AvatarGroupCount>+{avatars.length - 4}</AvatarGroupCount>}
    </AvatarGroup>
  )
}

interface SummaryRow {
  providers: ProviderAvatar[]
  purpose: string
  status: string
  selection?: string
}

function defaultLabel(
  selected: { modelId: string } | null,
  source?: { name: string; models: readonly { id: string; name: string }[] }
) {
  if (!selected) return undefined
  const model = source?.models.find((candidate) => candidate.id === selected.modelId)
  return source ? `${source.name} · ${model?.name ?? selected.modelId}` : selected.modelId
}

function configurationStatus(hasSelection: boolean, available: boolean, hasSources: boolean) {
  if (hasSelection) return available ? 'Configured' : 'Unavailable'
  return hasSources ? 'No default selected' : 'Not configured'
}

function modelSummary(
  snapshot: ProviderSettingsSnapshot,
  autocomplete: AutocompleteSettings | undefined,
  completionStatus: string
): SummaryRow[] {
  const agent = snapshot.agentCatalog
  const sources = agent.presets.filter((source) => source.authConfigured)
  const modelCount = sources.reduce(
    (total, source) =>
      total + (source.enabled ? source.models.filter((model) => model.enabled).length : 0),
    0
  )
  const agentSource = agent.presets.find(
    (source) => source.presetId === agent.defaultSelection?.presetId
  )
  const rows: SummaryRow[] = [
    {
      purpose: roleLabels.agent,
      providers: agentSource ? [agentSource, ...sources] : sources,
      status: `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} · ${modelCount} enabled ${modelCount === 1 ? 'model' : 'models'}`,
      selection: defaultLabel(agent.defaultSelection, agentSource)
    },
    {
      purpose: 'Autocomplete',
      providers:
        autocomplete?.sourceAvailable || autocomplete?.selection
          ? [{ name: 'DeepSeek', logoId: 'deepseek' }]
          : [],
      status: autocomplete
        ? configurationStatus(
            autocomplete.selection !== null,
            autocomplete.available,
            autocomplete.sourceAvailable
          )
        : completionStatus,
      selection: autocomplete?.selection
        ? `DeepSeek · ${autocomplete.selection.modelId}`
        : undefined
    }
  ]
  const image = snapshot.imageCatalog
  const imageSource = image.sources.find(
    (source) => source.sourceId === image.defaultSelection?.sourceId
  )
  rows.push({
    purpose: roleLabels.image,
    providers: (imageSource ? [imageSource, ...image.sources] : image.sources).map((source) => ({
      name: source.name,
      logoId: imageSourceLogoId({
        providerId: source.providerId,
        name: source.name,
        baseUrl: source.config && 'baseUrl' in source.config ? (source.config.baseUrl ?? '') : ''
      })
    })),
    status: configurationStatus(
      image.defaultSelection !== null,
      imageSource?.available === true,
      image.sources.length > 0
    ),
    selection: defaultLabel(image.defaultSelection, imageSource)
  })
  for (const role of ['embedding', 'rerank', 'mineru', 'speech'] as const) {
    const catalog = snapshot.purposeCatalog[role]
    const { source, model, available } = purposeDefault(catalog)
    const selection = catalog.defaultSelection
    const row = {
      purpose: roleLabels[role],
      providers: (source ? [source, ...catalog.sources] : catalog.sources).map((item) => ({
        name: item.name,
        logoId: resolveModelsDevProviderLogoId({
          providerId: item.providerId,
          name: role === 'mineru' ? 'MinerU' : item.name,
          baseUrl: item.baseUrl
        })
      })),
      status: configurationStatus(selection !== null, available, catalog.sources.length > 0),
      selection: selection
        ? `${source?.name ?? selection.sourceId} · ${model ? purposeModelLabel(role, model) : selection.configId}`
        : undefined
    }
    if (role === 'speech') rows.push(row)
    else rows.splice(rows.length - 1, 0, row)
  }
  return rows
}

export function SettingsOverview({
  snapshot,
  closeAction
}: {
  snapshot: ProviderSettingsSnapshot
  closeAction: ReactNode
}) {
  const { data, isError, isPending, refetch } = useQuery({
    queryKey: rendererQueryKeys.settings.autocomplete,
    queryFn: async () => {
      try {
        return await window.desktop.autocomplete.settings()
      } catch (err) {
        reportRendererOperationError(err, 'settings.overview.autocomplete')
        throw err
      }
    },
    staleTime: 0,
    retry: false
  })
  useEffect(
    () =>
      window.desktop.autocomplete.subscribeChanges(() => {
        void refetch()
      }),
    [refetch]
  )
  const rows = modelSummary(snapshot, data, isPending ? 'Loading…' : 'Unavailable')
  return (
    <ScrollArea className='h-full'>
      <div className='mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 lg:p-8'>
        <SettingsPageHeader icon={LayoutList} title='Overview' closeAction={closeAction} />
        <section aria-label='Model configuration' className='grid grid-cols-2 gap-3'>
          {rows.map((row) => (
            <section
              key={row.purpose}
              aria-label={row.purpose}
              className={`min-w-0 rounded-md border p-4 ${row.purpose === roleLabels.agent ? 'col-span-2' : ''}`}
            >
              <div className='flex items-center justify-between gap-2'>
                <h3 className='font-medium'>{row.purpose}</h3>
                <ProviderAvatars providers={row.providers} />
              </div>
              <p className='mt-1 text-sm text-muted-foreground'>{row.status}</p>
              {row.selection && (
                <p className='mt-3 break-words text-sm'>
                  <span className='text-muted-foreground'>Default · </span>
                  {row.selection}
                </p>
              )}
            </section>
          ))}
        </section>
        {isError && <p role='alert'>Autocomplete settings could not be loaded.</p>}
      </div>
    </ScrollArea>
  )
}
