import { describe, expect, it } from 'vitest'
import type { SourceModelCandidate } from '../../../../shared/contracts/providers'
import { modelCandidateGroups } from './model-candidate-controls'

const candidates: SourceModelCandidate[] = [
  {
    id: 'speech-both',
    name: 'Both modes',
    capability: 'transcription',
    speechModes: ['realtime', 'file'],
    availability: 'provider'
  },
  { id: 'speech-file', name: 'File only', capability: 'transcription', speechModes: ['file'] },
  { id: 'speech-unspecified', name: 'Unknown protocol', capability: 'transcription' },
  { id: 'image', name: 'Image', capability: 'image' },
  { id: 'chat', name: 'Chat', capability: 'other' },
  { id: 'fresh-id', name: 'Fresh unknown source ID' },
  { id: 'unknown', name: 'Unknown capability', capability: 'unknown', speechModes: ['file'] },
  {
    id: 'public-speech',
    name: 'Public speech',
    capability: 'transcription',
    metadataSource: 'models.dev',
    availability: 'catalog'
  },
  {
    id: 'public-image',
    name: 'Public image',
    capability: 'image',
    metadataSource: 'models.dev',
    availability: 'catalog'
  }
]

describe('model candidate capability suggestions', () => {
  it('filters only explicitly incompatible realtime suggestions and preserves unknown IDs', () => {
    const groups = modelCandidateGroups(candidates, {
      capability: 'transcription',
      mode: 'realtime'
    })
    expect(
      groups.map((group) => [group.heading, group.candidates.map((candidate) => candidate.id)])
    ).toEqual([
      ['Transcription', ['speech-both', 'speech-unspecified']],
      ['Other models', ['fresh-id', 'unknown']],
      ['Public catalog', ['public-speech']]
    ])
  })
  it('offers explicitly file-capable models in file mode without changing saved settings', () => {
    const before = structuredClone(candidates)
    const groups = modelCandidateGroups(candidates, { capability: 'transcription', mode: 'file' })
    expect(groups[0].candidates.map((candidate) => candidate.id)).toEqual([
      'speech-both',
      'speech-file',
      'speech-unspecified'
    ])
    expect(candidates).toEqual(before)
  })
  it('offers known image candidates and unknown source IDs without fabricating output sizes', () => {
    const groups = modelCandidateGroups(candidates, { capability: 'image' })
    expect(
      groups.map((group) => [group.heading, group.candidates.map((candidate) => candidate.id)])
    ).toEqual([
      ['Image models', ['image']],
      ['Other models', ['fresh-id', 'unknown']],
      ['Public catalog', ['public-image']]
    ])
    expect(
      groups.flatMap((group) => group.candidates).every((candidate) => !('imageSizes' in candidate))
    ).toBe(true)
  })
})
