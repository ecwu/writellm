import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
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
} from '../shared/contracts/skills'
import type { DesktopApi } from './desktop-api'

// Main registers one skills:changed subscription per webContents. Multiplex every Renderer
// listener here so one component unsubscribing cannot silence the others.
const skillChangeListeners = new Set<(revision: number) => void>()
let skillChangeDispatcherAttached = false

function attachSkillChangeDispatcher(): void {
  if (skillChangeDispatcherAttached) return
  ipcRenderer.on(IPC_CHANNELS.skillsChanged, (_event: Electron.IpcRendererEvent, raw: unknown) => {
    const revision = skillChangeEventSchema.parse(raw).revision
    for (const listener of skillChangeListeners) listener(revision)
  })
  skillChangeDispatcherAttached = true
}

export const skillsApi: DesktopApi['skills'] = {
  async snapshot() {
    return skillsSnapshotSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.skillsSnapshot))
  },
  async inspectGithub(input) {
    return inspectGithubSkillResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.skillsInspectGithub,
        inspectGithubSkillInputSchema.parse(input)
      )
    )
  },
  async install(input) {
    return skillMutationResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.skillsInstall, installSkillInputSchema.parse(input))
    ).snapshot
  },
  async setEnabled(input) {
    return skillMutationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.skillsSetEnabled,
        setSkillEnabledInputSchema.parse(input)
      )
    ).snapshot
  },
  async checkUpdate(input) {
    return skillUpdateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.skillsCheckUpdate, skillIdInputSchema.parse(input))
    )
  },
  async update(input) {
    return skillMutationResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.skillsUpdate, updateSkillInputSchema.parse(input))
    ).snapshot
  },
  async uninstall(input) {
    return skillMutationResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.skillsUninstall, uninstallSkillInputSchema.parse(input))
    ).snapshot
  },
  async cancelOperation(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.skillsCancelOperation,
      cancelSkillOperationInputSchema.parse(input)
    )
  },
  subscribeChanges(listener) {
    attachSkillChangeDispatcher()
    skillChangeListeners.add(listener)
    if (skillChangeListeners.size === 1) {
      ipcRenderer.send(IPC_CHANNELS.skillsSubscribeChanges)
    }
    return () => {
      skillChangeListeners.delete(listener)
      if (skillChangeListeners.size === 0) {
        ipcRenderer.send(IPC_CHANNELS.skillsUnsubscribeChanges)
      }
    }
  }
}
