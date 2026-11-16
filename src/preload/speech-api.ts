import { ipcRenderer } from 'electron'
import { speechEventSchema, speechIpcEndpoints, type SpeechApi } from '../shared/contracts/speech'
import { invokeIpcEndpoint } from './ipc-endpoint'
export const speechApi: SpeechApi = {
  start: (input) => invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.start, input),
  pushAudio: (input) => invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.pushAudio, input),
  finish: (input) => invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.finish, input),
  cancel: (input) => invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.cancel, input),
  testConnection: (input) =>
    invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.testConnection, input),
  cancelTest: () => invokeIpcEndpoint(ipcRenderer, speechIpcEndpoints.cancelTest),
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void =>
      listener(speechEventSchema.parse(raw))
    ipcRenderer.on('speech:event', handler)
    return () => ipcRenderer.removeListener('speech:event', handler)
  }
}
