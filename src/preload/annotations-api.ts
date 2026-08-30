import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  annotationRecordSchema,
  createAnnotationInputSchema,
  listAnnotationsInputSchema,
  listAnnotationsResultSchema,
  updateAnnotationInputSchema
} from '../shared/contracts/annotations'
import type { DesktopApi } from './desktop-api'

export const annotationsApi: DesktopApi['annotations'] = {
  async list(input) {
    return listAnnotationsResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.annotationsList,
        listAnnotationsInputSchema.parse(input)
      )
    )
  },
  async create(input) {
    return annotationRecordSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.annotationsCreate,
        createAnnotationInputSchema.parse(input)
      )
    )
  },
  async update(input) {
    return annotationRecordSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.annotationsUpdate,
        updateAnnotationInputSchema.parse(input)
      )
    )
  }
}
