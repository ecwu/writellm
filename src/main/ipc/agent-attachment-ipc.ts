import { BrowserWindow, clipboard, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { readBoundedAgentImage } from '../agent/attachment-file'
import { basename, extname } from 'node:path'
import type { Logger } from 'pino'
import {
  AGENT_IMAGE_MAX_BYTES,
  agentAttachmentActionSchema,
  agentAttachmentSelectSchema,
  agentAttachmentSelectionSchema,
  agentAttachmentImportSchema,
  agentAttachmentSchema,
  agentAttachmentScopeSchema,
  type AgentAttachment
} from '../../shared/contracts/agent-attachments'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProjectManager } from '../project/project-manager'
import type { AgentImageProcessClient } from '../agent/image-process-client'
import type { ManuscriptAssetCapabilities } from '../manuscript/asset-capabilities'
import { authorizeSender } from './authorize-sender'

export function registerAgentAttachmentIpc(options: {
  manager: ProjectManager
  processor: AgentImageProcessClient
  previews: ManuscriptAssetCapabilities
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>
}) {
  const active = new Map<
    AbortController,
    { session: string; agentSessionId: string; completion: Promise<void> }
  >()
  const handle = (channel: string, listener: Parameters<IpcMain['handle']>[1]): void => {
    options.ipc.handle(channel, async (event, raw: unknown) => {
      try {
        return await listener(event, raw)
      } catch (err) {
        options.log.error(
          { event: 'agent.attachment.ipc_failed', err, channel },
          'Agent image action failed'
        )
        throw new Error(
          'Image action failed. Reopen the project or choose a supported image within the size limits.',
          { cause: err }
        )
      }
    })
  }
  const service = (projectSessionId: string) => {
    const sessions = options.manager.assertActiveSession(projectSessionId).agentSessions
    if (!sessions) throw new Error('Agent sessions are unavailable')
    return sessions.attachments
  }
  const describe = (
    scope: { projectSessionId: string; agentSessionId: string },
    id: string
  ): AgentAttachment => {
    const attachments = service(scope.projectSessionId)
    const row = attachments.get(scope.agentSessionId, id)
    return agentAttachmentSchema.parse({
      attachmentId: id,
      name: row.name,
      mimeType: row.image_mime,
      byteSize: row.original_bytes,
      width: row.image_width,
      height: row.image_height,
      previewUrl: options.previews.issue({
        projectSessionId: scope.projectSessionId,
        assetId: id,
        assets: attachments
      }).url
    })
  }
  const importImage = async (
    scope: { projectSessionId: string; agentSessionId: string },
    bytes: Buffer,
    mimeType: string,
    name: string
  ) => {
    options.manager.assertMutationSession(scope.projectSessionId)
    const attachments = service(scope.projectSessionId)
    attachments.assertConversation(scope.agentSessionId)
    if (
      [...active.values()].filter(
        (request) =>
          request.session === scope.projectSessionId &&
          request.agentSessionId === scope.agentSessionId
      ).length >= 4
    )
      throw new Error('Wait for image processing to finish')
    const controller = new AbortController()
    let finish = () => {}
    const completion = new Promise<void>((resolve) => {
      finish = resolve
    })
    active.set(controller, {
      session: scope.projectSessionId,
      agentSessionId: scope.agentSessionId,
      completion
    })
    try {
      const image = await options.processor.process(
        bytes,
        mimeType,
        scope.projectSessionId,
        controller.signal
      )
      controller.signal.throwIfAborted()
      options.manager.assertMutationSession(scope.projectSessionId)
      const row = await attachments.store(
        scope.agentSessionId,
        name,
        bytes,
        mimeType,
        image,
        controller.signal
      )
      controller.signal.throwIfAborted()
      return describe(scope, row.attachment_id)
    } catch (err) {
      options.log.error(
        { event: 'agent.attachment.import_failed', err, agentSessionId: scope.agentSessionId },
        'Agent image import failed'
      )
      throw new Error(
        'Image import failed. Use a PNG, JPEG, or static WebP within the size limits.',
        { cause: err }
      )
    } finally {
      active.delete(controller)
      finish()
    }
  }
  handle(IPC_CHANNELS.agentImportImage, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentAttachmentImportSchema.parse(raw)
    return importImage(input, Buffer.from(input.dataBase64, 'base64'), input.mimeType, input.name)
  })
  handle(IPC_CHANNELS.agentSelectImages, async (event: IpcMainInvokeEvent, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentAttachmentSelectSchema.parse(raw)
    service(input.projectSessionId).assertConversation(input.agentSessionId)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const configuration: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    }
    const selected = await (parent
      ? dialog.showOpenDialog(parent, configuration)
      : dialog.showOpenDialog(configuration))
    if (selected.canceled)
      return agentAttachmentSelectionSchema.parse({ attachments: [], errors: [] })
    if (selected.filePaths.length > input.remaining)
      return agentAttachmentSelectionSchema.parse({
        attachments: [],
        errors: [`Choose up to ${input.remaining} images.`]
      })
    const attachments: AgentAttachment[] = []
    const errors: string[] = []
    for (const path of selected.filePaths) {
      try {
        const mimeType =
          extname(path).toLowerCase() === '.png'
            ? 'image/png'
            : extname(path).toLowerCase() === '.webp'
              ? 'image/webp'
              : 'image/jpeg'
        attachments.push(
          await importImage(input, await readBoundedAgentImage(path), mimeType, basename(path))
        )
      } catch (err) {
        options.log.error(
          {
            event: 'agent.attachment.selection_failed',
            err,
            agentSessionId: input.agentSessionId
          },
          'Selected image import failed'
        )
        errors.push('A selected image could not be imported.')
      }
    }
    return agentAttachmentSelectionSchema.parse({ attachments, errors })
  })
  handle(IPC_CHANNELS.agentPasteImage, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentAttachmentScopeSchema.parse(raw)
    service(input.projectSessionId).assertConversation(input.agentSessionId)
    for (const item of await clipboard.read()) {
      const mimeType = item.types.find((type) =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(type)
      )
      if (!mimeType) continue
      const blob = await item.getType(mimeType)
      if (!('arrayBuffer' in blob) || blob.size > AGENT_IMAGE_MAX_BYTES)
        throw new Error('Clipboard image exceeds 20 MiB')
      return importImage(input, Buffer.from(await blob.arrayBuffer()), mimeType, 'Pasted image')
    }
    return null
  })
  handle(IPC_CHANNELS.agentGetImage, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentAttachmentActionSchema.parse(raw)
    return describe(input, input.attachmentId)
  })
  handle(IPC_CHANNELS.agentReleaseImage, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentAttachmentActionSchema.parse(raw)
    service(input.projectSessionId).get(input.agentSessionId, input.attachmentId)
    service(input.projectSessionId).release(`draft:${input.agentSessionId}`, [input.attachmentId])
  })
  return {
    async revokeSession(projectSessionId: string) {
      const requests = [...active].filter(([, request]) => request.session === projectSessionId)
      for (const [controller] of requests)
        controller.abort(new Error('Project closed during image import'))
      await Promise.all(requests.map(([, request]) => request.completion))
    },
    async drainSession(projectSessionId: string) {
      await Promise.all(
        [...active.values()]
          .filter((request) => request.session === projectSessionId)
          .map((request) => request.completion)
      )
    },
    unregister() {
      for (const controller of active.keys()) controller.abort(new Error('Image input closed'))
      for (const channel of [
        IPC_CHANNELS.agentImportImage,
        IPC_CHANNELS.agentSelectImages,
        IPC_CHANNELS.agentPasteImage,
        IPC_CHANNELS.agentGetImage,
        IPC_CHANNELS.agentReleaseImage
      ])
        options.ipc.removeHandler(channel)
    }
  }
}
