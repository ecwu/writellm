import { useState } from 'react'
import type {
  ProviderSettingsSnapshot,
  ProviderConnectionTestResult,
  SpeechSourceStatus
} from '../../../../shared/contracts/providers'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { speechErrorMessage, SPEECH_SETUP_REQUIRED } from '../../../../shared/speech-errors'
import { reportRendererOperationError } from '../../diagnostics'
import { ModelCandidatePicker } from './model-candidate-controls'
import { ConfigField } from './provider-settings-common'

type SpeechMode = 'realtime' | 'file'

export function suggestedSpeechModelId(mode: SpeechMode): string {
  return mode === 'realtime' ? 'gpt-live-transcribe' : 'gpt-transcribe'
}

export function changeSpeechModelMode<T extends { mode: SpeechMode | null; modelId: string }>(
  draft: T,
  mode: SpeechMode,
  newModel: boolean
): Omit<T, 'mode' | 'modelId'> & { mode: SpeechMode; modelId: string } {
  const modelId =
    newModel && draft.mode !== null && draft.modelId === suggestedSpeechModelId(draft.mode)
      ? suggestedSpeechModelId(mode)
      : draft.modelId
  return { ...draft, modelId, mode }
}

export function SpeechModelFields({
  mode,
  onModeChange,
  onSelectModel,
  candidates,
  disabled = false
}: {
  mode: SpeechMode
  onModeChange: (mode: SpeechMode) => void
  onSelectModel: (modelId: string) => void
  candidates: SpeechSourceStatus['modelCandidates']
  disabled?: boolean
}): React.JSX.Element {
  return (
    <>
      <ConfigField label='Recognition mode'>
        <ToggleGroup
          type='single'
          variant='outline'
          aria-label='Recognition mode'
          value={mode}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === 'realtime' || value === 'file') onModeChange(value)
          }}
        >
          <ToggleGroupItem value='realtime'>Realtime</ToggleGroupItem>
          <ToggleGroupItem value='file'>After recording</ToggleGroupItem>
        </ToggleGroup>
      </ConfigField>
      <ModelCandidatePicker
        candidates={candidates}
        purpose={{ capability: 'transcription', mode }}
        disabled={disabled}
        onSelect={(candidate) => onSelectModel(candidate.id)}
      />
    </>
  )
}

export function SpeechModelDiscovery({
  sourceId,
  catalog,
  disabled = false,
  onSnapshotChange,
  onBusyChange,
  onError
}: {
  sourceId: string
  catalog: SpeechSourceStatus['catalog']
  disabled?: boolean
  onSnapshotChange: (snapshot: ProviderSettingsSnapshot) => void
  onBusyChange?: (busy: boolean) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const refresh = async (): Promise<void> => {
    setBusy(true)
    onBusyChange?.(true)
    try {
      onSnapshotChange(await window.desktop.providers.refreshSpeechModels({ sourceId }))
    } catch (err) {
      reportRendererOperationError(err, 'speech-settings.refresh-models')
      onError('Speech models could not be fetched.')
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }
  return (
    <div className='flex flex-wrap items-center gap-3'>
      <Button variant='outline' disabled={disabled || busy} onClick={() => void refresh()}>
        {busy ? <Spinner data-icon='inline-start' /> : null}Fetch models
      </Button>
      {catalog.status === 'stale' || catalog.status === 'unsupported' ? (
        <span role='status' className='text-sm text-muted-foreground'>
          {catalog.status === 'unsupported'
            ? 'Model discovery is unavailable for this source.'
            : 'Model discovery failed. The last successful list is kept.'}
        </span>
      ) : null}
    </div>
  )
}

export async function testSpeechPurposeModel(selection: {
  sourceId: string
  configId: string
}): Promise<ProviderConnectionTestResult> {
  const start = performance.now()
  const durationMs = () => Math.round(performance.now() - start)
  try {
    await window.desktop.speech.testConnection(selection)
    return {
      ok: true,
      code: 'connected',
      message: 'Connection succeeded.',
      durationMs: durationMs()
    }
  } catch (err) {
    reportRendererOperationError(err, 'speech-settings.test-connection')
    const message = speechErrorMessage(err)
    const code =
      message === SPEECH_SETUP_REQUIRED
        ? 'missing_config'
        : message === 'Speech connection timed out.'
          ? 'timeout'
          : /authentication failed|denied access/.test(message)
            ? 'invalid_auth'
            : message === 'Speech connection failed. Check the endpoint and network.'
              ? 'network_error'
              : 'provider_rejected'
    return { ok: false, code, message, durationMs: durationMs() }
  }
}
