import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  type ExtensionFactoryInstance
} from '@blocknote/core'
import { createReactInlineMathSpec, createReactMathBlockSpec } from '@blocknote/math-block'
import type { BlockNoteDocument } from '../../../../shared/contracts/manuscript'
import { diagramBlockSpec } from './rich-media-blocks'
import { figureImageBlockSpec } from './figure-image-block'

const nativeInlineMathSpec = createReactInlineMathSpec()
const nativeMathBlockSpec = createReactMathBlockSpec()

// BlockNote 0.54.0 exposes the native input-rule extension on the inline spec but its editor
// extension manager only auto-registers block-spec extensions. Pass this same native extension to
// the editor explicitly so both documented delimiter rules are active.
export const nativeInlineMathExtensions = (nativeInlineMathSpec.extensions ?? []).filter(
  (extension): extension is ExtensionFactoryInstance => typeof extension === 'function'
)

export const approvedEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    table: defaultBlockSpecs.table,
    image: figureImageBlockSpec,
    mathBlock: nativeMathBlockSpec,
    diagram: diagramBlockSpec
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: nativeInlineMathSpec
  },
  styleSpecs: defaultStyleSpecs
})

export type ApprovedEditorBlock = (typeof approvedEditorSchema.BlockNoteEditor)['document'][number]

interface SerializableBlock {
  type: string
  children?: SerializableBlock[]
  [key: string]: unknown
}

export function toApprovedEditorDocument(document: BlockNoteDocument): ApprovedEditorBlock[] {
  return JSON.parse(JSON.stringify(document)) as ApprovedEditorBlock[]
}

export function toCanonicalDocument(document: readonly ApprovedEditorBlock[]): BlockNoteDocument {
  const serializable = JSON.parse(JSON.stringify(document)) as SerializableBlock[]
  return stripMaterializedInlineMathProps(serializable) as BlockNoteDocument
}

function stripMaterializedInlineMathProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMaterializedInlineMathProps)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.type === 'math' && typeof record.content === 'string') {
    return { type: 'math', content: record.content }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, stripMaterializedInlineMathProps(entry)])
  )
}
