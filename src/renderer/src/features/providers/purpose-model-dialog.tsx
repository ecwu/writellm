import { useState } from 'react'
import {
  type PurposeModelDraft,
  type PurposeModelStatus,
  type PurposeSourceStatus,
  purposeModelDraftSchema
} from '../../../../shared/contracts/providers'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ModelCandidatePicker } from './model-candidate-controls'
import { ConfigField } from './provider-settings-common'
import {
  changeSpeechModelMode,
  SpeechModelFields,
  suggestedSpeechModelId
} from './speech-model-settings'

function initialModel(
  source: PurposeSourceStatus,
  model: PurposeModelStatus | null
): PurposeModelDraft {
  const { role } = source
  return {
    modelId:
      model?.modelId ??
      (role === 'mineru' ? 'vlm' : role === 'speech' ? suggestedSpeechModelId('realtime') : ''),
    mode: model?.mode ?? (role === 'speech' ? 'realtime' : null),
    modelRevision:
      model?.modelRevision ?? (role === 'embedding' || role === 'rerank' ? 'unspecified' : null),
    embeddingDimension: model?.embeddingDimension ?? (role === 'embedding' ? 1536 : null),
    enabled: model?.enabled ?? true
  }
}

export function PurposeModelDialog({
  source,
  model,
  busy,
  onClose,
  onSave
}: {
  source: PurposeSourceStatus
  model: PurposeModelStatus | null
  busy: boolean
  onClose: () => void
  onSave: (draft: PurposeModelDraft) => void
}) {
  const [original] = useState(() => initialModel(source, model))
  const [draft, setDraft] = useState(original)
  const [discardOpen, setDiscardOpen] = useState(false)
  const parsed = purposeModelDraftSchema.safeParse(draft)
  const dirty = JSON.stringify(original) !== JSON.stringify(draft)
  function requestClose() {
    if (busy) return
    if (dirty) setDiscardOpen(true)
    else onClose()
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{model === null ? 'Add model' : 'Edit model'}</DialogTitle>
            <DialogDescription className='sr-only'>
              Configure a model for {source.name}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {source.role === 'mineru' ? (
              <Field>
                <FieldLabel htmlFor='parsing-model-mode'>Parsing mode</FieldLabel>
                <Select
                  disabled={busy}
                  value={draft.modelId}
                  onValueChange={(modelId) => setDraft((current) => ({ ...current, modelId }))}
                >
                  <SelectTrigger id='parsing-model-mode'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='vlm'>VLM</SelectItem>
                    <SelectItem value='pipeline'>Pipeline</SelectItem>
                    <SelectItem value='MinerU-HTML'>MinerU HTML</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <>
                {source.role === 'speech' && draft.mode !== null ? (
                  <SpeechModelFields
                    mode={draft.mode}
                    onModeChange={(mode) =>
                      setDraft((current) => changeSpeechModelMode(current, mode, model === null))
                    }
                    onSelectModel={(modelId) => setDraft((current) => ({ ...current, modelId }))}
                    candidates={source.modelCandidates}
                    disabled={busy}
                  />
                ) : null}
                {source.role === 'embedding' && model === null ? (
                  <ModelCandidatePicker
                    candidates={source.modelCandidates}
                    purpose={{ capability: 'embedding' }}
                    disabled={busy}
                    onSelect={(candidate) =>
                      setDraft((current) => ({ ...current, modelId: candidate.id }))
                    }
                  />
                ) : null}
                <ConfigField label='Model ID'>
                  <Input
                    value={draft.modelId}
                    disabled={busy}
                    autoComplete='off'
                    onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                  />
                </ConfigField>
              </>
            )}
            {draft.modelRevision !== null ? (
              <ConfigField label='Model revision'>
                <Input
                  value={draft.modelRevision}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, modelRevision: event.target.value })}
                />
              </ConfigField>
            ) : null}
            {source.role === 'embedding' ? (
              <ConfigField label='Embedding dimensions'>
                <Input
                  type='number'
                  min={1}
                  step={1}
                  value={draft.embeddingDimension ?? ''}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      embeddingDimension:
                        event.target.value === '' ? null : Number(event.target.value)
                    })
                  }
                />
              </ConfigField>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button variant='outline' disabled={busy} onClick={requestClose}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !parsed.success ||
                (source.role === 'embedding' && draft.embeddingDimension === null) ||
                (model !== null && !dirty)
              }
              onClick={() => {
                if (parsed.success) onSave(parsed.data)
              }}
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              Save model
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard model changes?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
