import { ipcMain } from 'electron'
import { speechIpcEndpoints } from '../../shared/contracts/speech'
import type { SpeechService } from '../speech/speech-service'
import {
  createEndpointRegistrar,
  type TypedIpcMain,
  type ProjectSessionAuthorizer
} from './endpoint'

export function registerSpeechIpc(options: {
  service: SpeechService
  manager: ProjectSessionAuthorizer
  developmentUrl?: string
  ipc?: TypedIpcMain
  trustedSender: (senderId: number) => boolean
}) {
  const watchedSenders = new Set<number>()
  const register = createEndpointRegistrar(options.ipc ?? ipcMain, {
    manager: options.manager,
    developmentUrl: options.developmentUrl,
    wrap: async (event, _input, run) => {
      if (!options.trustedSender(event.sender.id) || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Unauthorized speech sender')
      if (!watchedSenders.has(event.sender.id)) {
        const senderId = event.sender.id
        watchedSenders.add(senderId)
        event.sender.once('destroyed', () => {
          watchedSenders.delete(senderId)
          options.service.revokeSender(senderId)
        })
        event.sender.on('render-process-gone', () => options.service.revokeSender(senderId))
        event.sender.on('did-start-navigation', () => options.service.revokeSender(senderId))
      }
      return run()
    }
  })
  const unregister = [
    register(speechIpcEndpoints.start, (input, _context, event) =>
      options.service.start(event.sender.id, input.projectSessionId)
    ),
    register(speechIpcEndpoints.pushAudio, (input, _context, event) =>
      options.service.pushAudio(event.sender.id, input)
    ),
    register(speechIpcEndpoints.finish, (input, _context, event) =>
      options.service.finish(event.sender.id, input)
    ),
    register(speechIpcEndpoints.cancel, (input, _context, event) =>
      options.service.cancel(event.sender.id, input)
    ),
    register(speechIpcEndpoints.testConnection, (input, _context, event) =>
      options.service.testConnection(event.sender.id, input?.sourceId)
    ),
    register(speechIpcEndpoints.cancelTest, (_input, _context, event) =>
      options.service.cancelTest(event.sender.id)
    )
  ]
  return {
    revokeSession: (id: string) => options.service.revokeSession(id),
    unregister: () => {
      for (const remove of unregister) remove()
      options.service.close()
    }
  }
}
