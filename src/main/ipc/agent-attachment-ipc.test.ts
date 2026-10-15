import { BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerAgentAttachmentIpc } from './agent-attachment-ipc'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  clipboard: { read: vi.fn(async () => []) },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }
}))
const projectSessionId = '11111111-1111-4111-8111-111111111111'
const agentSessionId = '11111111-1111-4111-8111-111111111112'
const attachmentId = '11111111-1111-4111-8111-111111111113'
const scope = { projectSessionId, agentSessionId }
const input = { ...scope, dataBase64: 'AAAA', mimeType: 'image/png', name: 'Example.png' }
const image = {
  type: 'image',
  data: 'AAAA',
  mimeType: 'image/png',
  width: 1,
  height: 1,
  sha256: 'a'.repeat(64)
} as const
const channels = [
  IPC_CHANNELS.agentImportImage,
  IPC_CHANNELS.agentSelectImages,
  IPC_CHANNELS.agentPasteImage,
  IPC_CHANNELS.agentGetImage,
  IPC_CHANNELS.agentReleaseImage
]

function harness() {
  vi.mocked(dialog.showOpenDialog).mockClear()
  vi.mocked(clipboard.read).mockClear()
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const row = {
    attachment_id: attachmentId,
    name: 'Example.png',
    image_mime: 'image/png',
    original_bytes: 3,
    image_width: 1,
    image_height: 1
  }
  const attachments = {
    assertConversation: vi.fn(),
    store: vi.fn(async () => row),
    get: vi.fn(() => row),
    release: vi.fn()
  }
  let revoked = false
  const assertSession = vi.fn((id: string) => {
    if (revoked || id !== projectSessionId) throw new Error('Project session revoked')
    return { agentSessions: { attachments } }
  })
  const processor = {
    process: vi.fn(
      async (_bytes: Buffer, _mimeType: string, _session: string, _signal: AbortSignal) => image
    )
  }
  const previews = { issue: vi.fn(() => ({ url: `writellm-asset://preview/${attachmentId}` })) }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const removeHandler = vi.fn((channel: string) => handlers.delete(channel))
  const registration = registerAgentAttachmentIpc({
    manager: { assertActiveSession: assertSession, assertMutationSession: assertSession } as never,
    processor: processor as never,
    previews: previews as never,
    log,
    developmentUrl: 'http://localhost:5173',
    ipc: { handle: (channel, handler) => handlers.set(channel, handler as never), removeHandler }
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender: { id: 7 }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, raw: unknown, source = event) =>
    handlers.get(channel)?.(source as never, raw as never)
  return {
    attachments,
    processor,
    previews,
    log,
    registration,
    invoke,
    event,
    revoke: () => {
      revoked = true
    },
    removeHandler,
    handlers
  }
}

describe('Agent attachment IPC', () => {
  it.each(channels)(
    'rejects unauthorized senders on %s before accessing project data',
    async (channel) => {
      const fixture = harness()
      await expect(
        fixture.invoke(channel, { ...input, attachmentId, remaining: 1 }, {
          ...fixture.event,
          senderFrame: { url: 'https://attacker.invalid/' }
        } as never)
      ).rejects.toMatchObject({ cause: { message: 'Unauthorized IPC sender' } })
      expect(fixture.attachments.get).not.toHaveBeenCalled()
      expect(fixture.processor.process).not.toHaveBeenCalled()
      expect(dialog.showOpenDialog).not.toHaveBeenCalled()
      expect(clipboard.read).not.toHaveBeenCalled()
    }
  )

  it.each(channels)(
    'rejects malformed input on %s before project or native actions',
    async (channel) => {
      const fixture = harness()
      await expect(
        fixture.invoke(channel, {
          ...scope,
          attachmentId: 'invalid',
          dataBase64: '???',
          mimeType: 'image/gif',
          name: '',
          remaining: 5
        })
      ).rejects.toMatchObject({ cause: { name: 'ZodError' } })
      expect(fixture.processor.process).not.toHaveBeenCalled()
      expect(fixture.attachments.get).not.toHaveBeenCalled()
      expect(dialog.showOpenDialog).not.toHaveBeenCalled()
      expect(clipboard.read).not.toHaveBeenCalled()
    }
  )

  it('imports, describes, and releases a conversation-owned image without exposing bytes or paths', async () => {
    const fixture = harness()
    const result = await fixture.invoke(IPC_CHANNELS.agentImportImage, input)
    expect(result).toEqual({
      attachmentId,
      name: 'Example.png',
      mimeType: 'image/png',
      byteSize: 3,
      width: 1,
      height: 1,
      previewUrl: `writellm-asset://preview/${attachmentId}`
    })
    expect(fixture.processor.process).toHaveBeenCalledWith(
      Buffer.from('AAAA', 'base64'),
      'image/png',
      projectSessionId,
      expect.any(AbortSignal)
    )
    expect(fixture.attachments.store).toHaveBeenCalledWith(
      agentSessionId,
      input.name,
      Buffer.from('AAAA', 'base64'),
      input.mimeType,
      image,
      expect.any(AbortSignal)
    )
    expect(fixture.previews.issue).toHaveBeenCalledWith({
      projectSessionId,
      assetId: attachmentId,
      assets: fixture.attachments
    })
    await expect(
      fixture.invoke(IPC_CHANNELS.agentGetImage, { ...scope, attachmentId })
    ).resolves.toEqual(result)
    await fixture.invoke(IPC_CHANNELS.agentReleaseImage, { ...scope, attachmentId })
    expect(fixture.attachments.get).toHaveBeenCalledWith(agentSessionId, attachmentId)
    expect(fixture.attachments.release).toHaveBeenCalledWith(`draft:${agentSessionId}`, [
      attachmentId
    ])
  })

  it.each(channels)('rejects a revoked project session on %s', async (channel) => {
    const fixture = harness()
    fixture.revoke()
    const raw =
      channel === IPC_CHANNELS.agentImportImage
        ? input
        : channel === IPC_CHANNELS.agentSelectImages
          ? { ...scope, remaining: 1 }
          : channel === IPC_CHANNELS.agentPasteImage
            ? scope
            : { ...scope, attachmentId }
    await expect(fixture.invoke(channel, raw)).rejects.toMatchObject({
      cause: { message: 'Project session revoked' }
    })
    expect(fixture.processor.process).not.toHaveBeenCalled()
    expect(fixture.attachments.store).not.toHaveBeenCalled()
    expect(fixture.previews.issue).not.toHaveBeenCalled()
  })

  it('aborts and drains in-flight imports on session revocation without storing a late result', async () => {
    const fixture = harness()
    let finish!: (value: typeof image) => void
    fixture.processor.process.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = fixture.invoke(IPC_CHANNELS.agentImportImage, input)
    const failed = expect(pending).rejects.toMatchObject({
      cause: { cause: { message: 'Project closed during image import' } }
    })
    const closing = fixture.registration.revokeSession(projectSessionId)
    expect(fixture.processor.process.mock.calls[0]?.[3].aborted).toBe(true)
    finish(image)
    await Promise.all([failed, closing, fixture.registration.drainSession(projectSessionId)])
    expect(fixture.attachments.store).not.toHaveBeenCalled()
  })

  it('reauthorizes the project after image processing before storing any result', async () => {
    const fixture = harness()
    fixture.processor.process.mockImplementationOnce(async () => {
      fixture.revoke()
      return image
    })
    await expect(fixture.invoke(IPC_CHANNELS.agentImportImage, input)).rejects.toMatchObject({
      cause: { cause: { message: 'Project session revoked' } }
    })
    expect(fixture.attachments.store).not.toHaveBeenCalled()
  })

  it('returns an empty selection after native cancellation and rejects too many selected images', async () => {
    const fixture = harness()
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null)
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(
      fixture.invoke(IPC_CHANNELS.agentSelectImages, { ...scope, remaining: 1 })
    ).resolves.toEqual({ attachments: [], errors: [] })
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/private/one.png', '/private/two.png']
    })
    await expect(
      fixture.invoke(IPC_CHANNELS.agentSelectImages, { ...scope, remaining: 1 })
    ).resolves.toEqual({ attachments: [], errors: ['Choose up to 1 images.'] })
    expect(fixture.processor.process).not.toHaveBeenCalled()
  })

  it('returns null when the clipboard contains no supported image', async () => {
    const fixture = harness()
    vi.mocked(clipboard.read).mockResolvedValueOnce([])
    await expect(fixture.invoke(IPC_CHANNELS.agentPasteImage, scope)).resolves.toBeNull()
    expect(fixture.processor.process).not.toHaveBeenCalled()
  })

  it('reports an image processing failure once through the outer IPC wrapper', async () => {
    const fixture = harness()
    const cause = new Error('Image decoder failed')
    fixture.processor.process.mockRejectedValueOnce(cause)
    // Wrap the registered handler as production does, so request-local reporting is active.
    const { withIpcLogging } = await import('../observability/ipc-context')
    let invoke!: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    withIpcLogging(
      {
        handle: (_channel, listener) => {
          invoke = listener
        },
        removeHandler: vi.fn()
      },
      fixture.log
    ).handle('test:attachment', fixture.handlers.get(IPC_CHANNELS.agentImportImage) as never)
    await expect(invoke(fixture.event, input)).rejects.toMatchObject({ cause: { cause } })
    expect(fixture.log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'agent.attachment.import_failed', err: cause }),
      expect.any(String)
    )
    fixture.registration.unregister()
    expect(fixture.removeHandler).toHaveBeenCalledTimes(5)
  })
})
