import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  jobStatusEventSchema,
  jobStatusInputSchema,
  jobStatusSchema,
  listJobsInputSchema,
  listJobsResultSchema
} from '../shared/contracts/jobs'
import type { DesktopApi } from './desktop-api'

export const jobsApi: DesktopApi['jobs'] = {
  async list(input) {
    return listJobsResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.jobsList, listJobsInputSchema.parse(input))
    )
  },
  async status(input) {
    return jobStatusSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.jobsGetStatus, jobStatusInputSchema.parse(input))
    )
  },
  async cancel(input) {
    return jobStatusSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.jobsRequestCancellation,
        jobStatusInputSchema.parse(input)
      )
    )
  },
  async subscribe(input, listener) {
    const parsedInput = jobStatusInputSchema.omit({ jobId: true }).parse(input)
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const statusEvent = jobStatusEventSchema.parse(value)
      if (statusEvent.projectSessionId === parsedInput.projectSessionId) listener(statusEvent)
    }
    ipcRenderer.on(IPC_CHANNELS.jobsStatusEvent, handler)
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.jobsSubscribeStatus, parsedInput)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.jobsStatusEvent, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.jobsStatusEvent, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.jobsUnsubscribeStatus, parsedInput)
    }
  }
}
