import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs
} from '@blocknote/core'
import { mathBlockSpec, mermaidBlockSpec } from './rich-media-blocks'

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
    image: defaultBlockSpecs.image,
    mermaid: mermaidBlockSpec,
    math: mathBlockSpec
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: defaultStyleSpecs
})

export type ApprovedEditorBlock = (typeof approvedEditorSchema.BlockNoteEditor)['document'][number]
