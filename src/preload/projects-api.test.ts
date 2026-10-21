import { ipcRenderer } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { projectIpcEndpoints } from '../shared/contracts/ipc-endpoints-project'
import { projectsApi } from './projects-api'

vi.mock('electron', () => ({ ipcRenderer: { invoke: vi.fn() } }))

describe('project preload recovery methods', () => {
  it('keeps zero-argument recovery methods while sending a validated empty request', async () => {
    const closed = { state: 'closed' as const, activeProject: null }
    for (const name of [
      'retryOpen',
      'recoverStaleLock',
      'retryClose',
      'discardIncompleteCreate',
      'returnToClosed'
    ] as const) {
      vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(closed)
      await expect(projectsApi[name]()).resolves.toEqual(closed)
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(projectIpcEndpoints[name].channel, {})
    }
    for (const name of ['locateMoved', 'restoreSnapshot'] as const) {
      vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ project: null })
      await expect(projectsApi[name]()).resolves.toEqual({ project: null })
      expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(projectIpcEndpoints[name].channel, {})
    }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ exported: false })
    await expect(projectsApi.exportRecoveryDiagnostics()).resolves.toEqual({ exported: false })
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
      projectIpcEndpoints.exportRecoveryDiagnostics.channel,
      {}
    )
  })
})
