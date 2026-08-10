import { ipcMain, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import {
  cancelSkillOperationInputSchema,
  inspectGithubSkillInputSchema,
  inspectGithubSkillResultSchema,
  installSkillInputSchema,
  setSkillEnabledInputSchema,
  skillChangeEventSchema,
  skillIdInputSchema,
  skillMutationResultSchema,
  skillsSnapshotSchema,
  skillUpdateResultSchema,
  uninstallSkillInputSchema,
  updateSkillInputSchema
} from '../../shared/contracts/skills'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { SkillService } from '../skills/skill-service'
import { authorizeSender } from './authorize-sender'

interface SkillIpcMain
  extends Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'> {}

export function registerSkillIpc(options: {
  service: SkillService
  logger: Logger
  developmentUrl?: string
  ipc?: SkillIpcMain
}): () => void {
  const ipc = options.ipc ?? ipcMain
  const subscribers = new Map<number, WebContents>()
  const publish = (revision: number): void => {
    const event = skillChangeEventSchema.parse({ revision })
    for (const [id, sender] of subscribers) {
      if (sender.isDestroyed()) subscribers.delete(id)
      else sender.send(IPC_CHANNELS.skillsChanged, event)
    }
  }
  const unsubscribeService = options.service.subscribe(publish)

  ipc.handle(IPC_CHANNELS.skillsSnapshot, (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    return skillsSnapshotSchema.parse(options.service.snapshot())
  })
  ipc.handle(IPC_CHANNELS.skillsInspectGithub, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = inspectGithubSkillInputSchema.parse(raw)
    return inspectGithubSkillResultSchema.parse(
      await options.service.inspectGithub(input, input.operationId)
    )
  })
  ipc.handle(IPC_CHANNELS.skillsInstall, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = installSkillInputSchema.parse(raw)
    const snapshot =
      input.source === 'curated'
        ? await options.service.installCurated(input.skillId, input.operationId)
        : await options.service.installInspected(input.inspectionId)
    return skillMutationResultSchema.parse({ snapshot })
  })
  ipc.handle(IPC_CHANNELS.skillsSetEnabled, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = setSkillEnabledInputSchema.parse(raw)
    return skillMutationResultSchema.parse({
      snapshot: options.service.setEnabled(input.skillId, input.enabled, input.cascade)
    })
  })
  ipc.handle(IPC_CHANNELS.skillsCheckUpdate, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = skillIdInputSchema.parse(raw)
    return skillUpdateResultSchema.parse(
      await options.service.checkUpdate(input.skillId, input.operationId)
    )
  })
  ipc.handle(IPC_CHANNELS.skillsUpdate, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = updateSkillInputSchema.parse(raw)
    return skillMutationResultSchema.parse({
      snapshot: await options.service.update(
        input.skillId,
        input.confirmUnreviewed,
        input.operationId
      )
    })
  })
  ipc.handle(IPC_CHANNELS.skillsUninstall, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = uninstallSkillInputSchema.parse(raw)
    return skillMutationResultSchema.parse({
      snapshot: await options.service.uninstall(input.skillId, input.cascade)
    })
  })
  ipc.handle(IPC_CHANNELS.skillsCancelOperation, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = cancelSkillOperationInputSchema.parse(raw)
    options.service.cancelOperation(input.operationId)
  })

  const subscribe = (event: Electron.IpcMainEvent): void => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    subscribers.set(event.sender.id, event.sender)
  }
  const unsubscribe = (event: Electron.IpcMainEvent): void => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    subscribers.delete(event.sender.id)
  }
  ipc.on(IPC_CHANNELS.skillsSubscribeChanges, subscribe)
  ipc.on(IPC_CHANNELS.skillsUnsubscribeChanges, unsubscribe)

  return () => {
    unsubscribeService()
    subscribers.clear()
    for (const channel of [
      IPC_CHANNELS.skillsSnapshot,
      IPC_CHANNELS.skillsInspectGithub,
      IPC_CHANNELS.skillsInstall,
      IPC_CHANNELS.skillsSetEnabled,
      IPC_CHANNELS.skillsCheckUpdate,
      IPC_CHANNELS.skillsUpdate,
      IPC_CHANNELS.skillsUninstall,
      IPC_CHANNELS.skillsCancelOperation
    ]) {
      ipc.removeHandler(channel)
    }
    ipc.removeListener(IPC_CHANNELS.skillsSubscribeChanges, subscribe)
    ipc.removeListener(IPC_CHANNELS.skillsUnsubscribeChanges, unsubscribe)
    options.logger.info({ event: 'skill.ipc.unregistered' }, 'Writing skill IPC unregistered')
  }
}
