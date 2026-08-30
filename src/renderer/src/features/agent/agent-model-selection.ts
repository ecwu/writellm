import type {
  AgentModelSelection,
  AgentProviderCatalog
} from '../../../../shared/contracts/providers'

export type AvailableAgentPreset = AgentProviderCatalog['presets'][number]

export function findAgentModelSelection(
  presets: AvailableAgentPreset[],
  selection: AgentModelSelection | null
): { preset: AvailableAgentPreset; model: AvailableAgentPreset['models'][number] } | null {
  if (selection === null) return null
  const preset = presets.find((candidate) => candidate.presetId === selection.presetId)
  const model = preset?.models.find((candidate) => candidate.id === selection.modelId)
  return preset === undefined || model === undefined ? null : { preset, model }
}
