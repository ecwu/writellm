import { app, ipcMain } from 'electron'
import { appInfoSchema } from '../../shared/contracts/app'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { authorizeSender } from './authorize-sender'

export function registerIpcHandlers(developmentUrl?: string): () => void {
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (event) => {
    authorizeSender(event.senderFrame, developmentUrl)

    return appInfoSchema.parse({
      name: app.getName(),
      version: app.getVersion()
    })
  })

  return () => ipcMain.removeHandler(IPC_CHANNELS.appGetInfo)
}
