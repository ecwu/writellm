import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { projectSessionInputSchema } from '../shared/contracts/projects'
import {
  workbenchLayoutSchema,
  workbenchLayoutSaveSchema,
  type WorkbenchApi
} from '../shared/contracts/workbench'
export const workbenchApi: WorkbenchApi = {
  async read(input) {
    return workbenchLayoutSchema
      .nullable()
      .parse(
        await ipcRenderer.invoke(
          IPC_CHANNELS.workbenchLayoutRead,
          projectSessionInputSchema.parse(input)
        )
      )
  },
  async save(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.workbenchLayoutSave,
      workbenchLayoutSaveSchema.parse(input)
    )
  },
  async reset(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.workbenchLayoutReset,
      projectSessionInputSchema.parse(input)
    )
  }
}
