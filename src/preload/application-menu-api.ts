import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  menuStateSchema,
  menuCommandEventSchema,
  menuUpdateResultSchema,
  type ApplicationMenuApi
} from '../shared/contracts/application-menu'

export const applicationMenuApi: ApplicationMenuApi = {
  native: process.platform === 'darwin',
  async update(state) {
    return menuUpdateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.menuUpdate, menuStateSchema.parse(state))
    )
  },
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) =>
      listener(menuCommandEventSchema.parse(input))
    ipcRenderer.on(IPC_CHANNELS.menuCommand, receive)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.menuCommand, receive)
    }
  }
}
