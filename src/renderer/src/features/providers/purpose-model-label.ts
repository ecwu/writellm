import type {
  PurposeModelSelection,
  PurposeModelStatus,
  PurposeProviderRole,
  PurposeSourceStatus
} from '../../../../shared/contracts/providers'

const parsingModeNames: Record<string, string> = {
  pipeline: 'Pipeline',
  vlm: 'VLM',
  'MinerU-HTML': 'MinerU HTML'
}

export function purposeModelLabel(role: PurposeProviderRole, model: PurposeModelStatus): string {
  if (role === 'mineru') return parsingModeNames[model.modelId] ?? model.modelId
  if (model.mode !== null) {
    return `${model.modelId} (${model.mode === 'realtime' ? 'Realtime' : 'File'})`
  }
  if (model.modelRevision && model.modelRevision !== 'unspecified') {
    return `${model.modelId} (${model.modelRevision})`
  }
  return model.modelId
}

export function purposeDefault(catalog: {
  sources: readonly PurposeSourceStatus[]
  defaultSelection: PurposeModelSelection | null
}) {
  const selection = catalog.defaultSelection
  const source = catalog.sources.find(({ sourceId }) => sourceId === selection?.sourceId)
  const model = source?.models.find(({ configId }) => configId === selection?.configId)
  return {
    source,
    model,
    available: source?.available === true && source.enabled && model?.enabled === true
  }
}
