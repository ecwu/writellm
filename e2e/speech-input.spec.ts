import { join } from 'node:path'
import { agentToggle } from './application-menu'
import { expect, launchApp, scenario, test } from './fixtures'
import { configureAgentProvider, createProject } from './helpers/project'
import {
  captureEvidence,
  configureSpeech,
  prepareSyntheticMicrophone,
  startSpeechMock
} from './helpers/speech'

const chromiumArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

async function setupSpeechProject(
  page: import('@playwright/test').Page,
  baseUrl: string
): Promise<void> {
  await configureAgentProvider(page, baseUrl, { providerName: 'Speech Agent' })
  await page.evaluate(async () => {
    const snapshot = await window.desktop.providers.snapshot()
    const preset = snapshot.agentCatalog.presets.find((item) => item.name === 'Speech Agent')
    if (!preset) throw new Error('Speech Agent preset missing')
    await window.desktop.providers.setAgentDefault({
      presetId: preset.presetId,
      modelId: 'writer-model'
    })
  })
  await createProject(page, 'Speech input project')
  if ((await agentToggle(page).getAttribute('aria-pressed')) !== 'true')
    await agentToggle(page).click()
  await expect(page.getByTestId('agent-panel').getByLabel('Agent message')).toBeVisible()
}

function wavHeader(bytes: Buffer) {
  const offset = bytes.indexOf(Buffer.from('RIFF'))
  if (offset < 0) throw new Error('WAV header missing from multipart upload')
  return {
    format: bytes.toString('ascii', offset + 8, offset + 12),
    channels: bytes.readUInt16LE(offset + 22),
    sampleRate: bytes.readUInt32LE(offset + 24),
    bits: bytes.readUInt16LE(offset + 34),
    audioBytes: bytes.readUInt32LE(offset + 40)
  }
}

test(
  'dictates through the static Worklet and preserves draft and Agent controls',
  scenario('speech.realtime-draft-controls', ['@packaged']),
  async ({ testRoot }) => {
    const mock = await startSpeechMock()
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      chromiumArgs
    })
    try {
      await setupSpeechProject(launched.page, mock.baseUrl)
      await prepareSyntheticMicrophone(launched.app, launched.page)
      const missingConfigPanel = launched.page.getByTestId('agent-panel')
      await missingConfigPanel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect(
        missingConfigPanel.getByText('Set up Speech input in Settings before starting dictation.', {
          exact: true
        })
      ).toBeVisible()
      expect(mock.connections).toHaveLength(0)
      expect(await captureEvidence(launched.page)).toMatchObject({
        requests: 0,
        tracks: [],
        contextStates: []
      })
      await missingConfigPanel
        .getByRole('button', { name: 'Cancel dictation', exact: true })
        .click()
      const setupCancelledAt = Date.now()
      await configureSpeech(launched.page, mock.baseUrl, 'realtime')
      await expect.poll(() => Date.now()).toBeGreaterThan(setupCancelledAt + 400)
      const panel = launched.page.getByTestId('agent-panel')
      const draft = panel.getByLabel('Agent message')
      const original = 'Before selected after'
      await draft.fill(original)
      await draft.evaluate((element) => (element as HTMLTextAreaElement).setSelectionRange(7, 15))
      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect.poll(() => mock.connections[0]?.frames.length ?? 0).toBeGreaterThan(0)
      await expect(draft).toHaveValue('Before 研究背景预览 after')
      await expect(draft).toHaveAttribute('readonly', '')
      await draft.press('Enter')
      await launched.page.keyboard.down('Enter')
      await launched.page.keyboard.down('Enter')
      await launched.page.keyboard.up('Enter')
      expect(mock.agentRequests).toHaveLength(0)
      await launched.page.keyboard.press('Escape')
      const cancelledAt = Date.now()
      await expect(draft).toHaveValue(original)
      await expect(draft).toBeFocused()
      await expect
        .poll(() =>
          draft.evaluate((element) => [
            (element as HTMLTextAreaElement).selectionStart,
            (element as HTMLTextAreaElement).selectionEnd
          ])
        )
        .toEqual([7, 15])
      await expect.poll(() => mock.connections[0]?.closed).toBe(true)
      await expect
        .poll(async () => (await captureEvidence(launched.page)).tracks)
        .toEqual(['ended'])
      await expect.poll(() => Date.now()).toBeGreaterThan(cancelledAt + 400)

      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect.poll(() => mock.connections[1]?.frames.length ?? 0).toBeGreaterThan(0)
      await panel.getByRole('button', { name: 'Finish recording', exact: true }).dblclick()
      await expect.poll(() => mock.connections[1]?.commits).toBe(1)
      await expect(
        panel.getByRole('button', { name: 'Finish recording', exact: true })
      ).toBeDisabled()
      await draft.focus()
      await launched.page.keyboard.down('Enter')
      mock.complete(mock.connections[1])
      const completedAt = Date.now()
      await expect(draft).toHaveValue('Before 研究背景终稿 after')
      await expect(draft).not.toHaveAttribute('readonly', '')
      await launched.page.keyboard.down('Enter')
      await launched.page.keyboard.up('Enter')
      expect(mock.connections[1].commits).toBe(1)
      expect(mock.agentRequests).toHaveLength(0)
      await expect.poll(() => Date.now()).toBeGreaterThan(completedAt + 400)
      expect(mock.agentRequests).toHaveLength(0)
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => mock.agentRequests.length).toBe(1)
      expect(mock.agentRequests[0].body).toContain('研究背景终稿')

      await draft.fill('Independent recording: ')
      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect.poll(() => mock.connections[2]?.frames.length ?? 0).toBeGreaterThan(0)
      await panel.getByRole('button', { name: 'Stop Agent', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Stop Agent', exact: true })).toHaveCount(0)
      await expect(
        panel.getByRole('button', { name: 'Finish recording', exact: true })
      ).toBeEnabled()
      await expect(draft).toHaveAttribute('readonly', '')
      await panel.getByRole('button', { name: 'Cancel dictation', exact: true }).click()
      await expect(draft).toHaveValue('Independent recording: ')
      await expect
        .poll(async () =>
          (await captureEvidence(launched.page)).tracks.every((state) => state === 'ended')
        )
        .toBe(true)
      const evidence = await captureEvidence(launched.page)
      expect(evidence.requests).toBe(3)
      expect(evidence.worklets).toHaveLength(3)
      expect(
        evidence.worklets.every(
          (url) => url === `${evidence.origin}/audio/speech-capture.worklet.js`
        )
      ).toBe(true)
      expect(
        mock.connections
          .flatMap((connection) => connection.frames)
          .every((bytes) => bytes > 0 && bytes <= 4800 && bytes % 2 === 0)
      ).toBe(true)
      expect(mock.agentRequests).toHaveLength(1)
    } catch (err) {
      await test.info().attach('speech-capture-stages', {
        body: JSON.stringify(await captureEvidence(launched.page)),
        contentType: 'application/json'
      })
      throw err
    } finally {
      await launched.app.close()
      await mock.close()
    }
  }
)

test(
  'tests saved speech settings with cancellation and captures file audio without auto sending',
  scenario('speech.file-settings-lifecycle', ['@packaged']),
  async ({ testRoot }) => {
    const mock = await startSpeechMock()
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      chromiumArgs
    })
    try {
      await configureSpeech(launched.page, mock.baseUrl, 'realtime')
      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.getByRole('option', { name: /^Speech input/ }).click()
      await settings
        .getByTestId('speech-source-list')
        .getByRole('button', { name: /^Speech test/ })
        .click()
      mock.rejectConfiguration()
      await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
      await expect(
        launched.page.getByText(
          'Speech provider rejected a configured parameter. Parameter: session.audio.input.transcription.languages.',
          { exact: true }
        )
      ).toBeVisible()
      await expect(
        launched.page.getByText('private diagnostic must not reach the UI', { exact: true })
      ).toHaveCount(0)
      await expect.poll(() => mock.connections[0].closed).toBe(true)
      mock.connections.splice(0)
      mock.holdSessions()
      await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
      await expect.poll(() => mock.connections.length).toBe(1)
      await settings.getByRole('button', { name: 'Cancel test', exact: true }).click()
      await expect.poll(() => mock.connections[0].closed).toBe(true)
      // Cancellation uses the existing error callback; dismiss its toast before continuing.
      await expect(
        settings.getByRole('button', { name: 'Test connection', exact: true })
      ).toBeEnabled()
      await settings.getByRole('radio', { name: 'After recording', exact: true }).click()
      await settings.getByRole('button', { name: 'Save changes', exact: true }).click()
      await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
      await expect.poll(() => mock.files.length).toBe(1)
      expect(wavHeader(mock.files[0].bytes)).toEqual({
        format: 'WAVE',
        channels: 1,
        sampleRate: 24000,
        bits: 16,
        audioBytes: 48000
      })
      mock.files[0].response.writeHead(200, { 'content-type': 'application/json' })
      mock.files[0].response.end('{"text":""}')
      await expect(settings.getByText('Connected', { exact: true })).toBeVisible()
      await launched.page.keyboard.press('Escape')
      await setupSpeechProject(launched.page, mock.baseUrl)
      await prepareSyntheticMicrophone(launched.app, launched.page)
      const panel = launched.page.getByTestId('agent-panel')
      const draft = panel.getByLabel('Agent message')
      await draft.fill('File draft: ')
      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect(
        panel.getByRole('button', { name: 'Finish recording', exact: true })
      ).toBeEnabled()
      await expect.poll(async () => (await captureEvidence(launched.page)).requests).toBe(1)
      // Poll the recording timer so there is non-empty synthetic audio before finish.
      await expect(panel.getByText('00:01', { exact: true })).toBeVisible()
      await expect(draft).toHaveValue('File draft: ')
      expect(mock.files).toHaveLength(1)
      await panel.getByRole('button', { name: 'Finish recording', exact: true }).click()
      await expect.poll(() => mock.files.length).toBe(2)
      const header = wavHeader(mock.files[1].bytes)
      expect(header).toMatchObject({ format: 'WAVE', channels: 1, sampleRate: 24000, bits: 16 })
      expect(header.audioBytes).toBeGreaterThan(0)
      expect(header.audioBytes).toBeLessThanOrEqual(5760000)
      await draft.press('Enter')
      mock.files[1].response.writeHead(200, { 'content-type': 'application/json' })
      mock.files[1].response.end('{"text":"文件识别终稿"}')
      await expect(draft).toHaveValue('File draft: 文件识别终稿')
      await expect(draft).toBeFocused()
      expect(mock.agentRequests).toHaveLength(0)
      expect((await captureEvidence(launched.page)).tracks).toEqual(['ended'])
      await draft.fill('校对后的文字')
      await expect(draft).toHaveValue('校对后的文字')
      expect(mock.agentRequests).toHaveLength(0)
    } catch (err) {
      await test.info().attach('speech-capture-stages', {
        body: JSON.stringify(await captureEvidence(launched.page)),
        contentType: 'application/json'
      })
      throw err
    } finally {
      await launched.app.close()
      await mock.close()
    }
  }
)

test(
  'bounds pending microphone preparation and releases late streams after timeout and cancellation',
  scenario('speech.preparation-timeout-recovery', ['@packaged']),
  async ({ testRoot }) => {
    const mock = await startSpeechMock()
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      chromiumArgs
    })
    try {
      await configureSpeech(launched.page, mock.baseUrl, 'realtime')
      await setupSpeechProject(launched.page, mock.baseUrl)
      await prepareSyntheticMicrophone(launched.app, launched.page)
      await launched.page.evaluate(() => {
        const state = {
          pending: [] as Array<(stream: MediaStream) => void>,
          tracks: [] as MediaStreamTrack[],
          contexts: [] as AudioContext[]
        }
        Object.assign(window, { pendingSpeechCapture: state })
        navigator.mediaDevices.getUserMedia = () =>
          new Promise<MediaStream>((resolve) => state.pending.push(resolve))
      })
      const panel = launched.page.getByTestId('agent-panel')
      const draft = panel.getByLabel('Agent message')
      const pendingCount = () =>
        launched.page.evaluate(
          () =>
            (window as unknown as { pendingSpeechCapture: { pending: unknown[] } })
              .pendingSpeechCapture.pending.length
        )
      const resolveLate = (index: number) =>
        launched.page.evaluate((index) => {
          const state = (
            window as unknown as {
              pendingSpeechCapture: {
                pending: Array<(stream: MediaStream) => void>
                tracks: MediaStreamTrack[]
                contexts: AudioContext[]
              }
            }
          ).pendingSpeechCapture
          // A silent in-memory Web Audio destination supplies a real track without any device.
          const context = new AudioContext()
          const stream = context.createMediaStreamDestination().stream
          state.contexts.push(context)
          state.tracks.push(...stream.getTracks())
          state.pending[index](stream)
        }, index)
      const trackStates = () =>
        launched.page.evaluate(() =>
          (
            window as unknown as { pendingSpeechCapture: { tracks: MediaStreamTrack[] } }
          ).pendingSpeechCapture.tracks.map((track) => track.readyState)
        )
      await draft.fill('Keep this original draft.')
      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect.poll(pendingCount).toBe(1)
      await expect(
        panel.getByText('Microphone preparation timed out. Check the input device and try again.', {
          exact: true
        })
      ).toBeVisible({ timeout: 15000 })
      await expect.poll(() => mock.connections[0]?.closed).toBe(true)
      await expect(draft).toHaveValue('Keep this original draft.')
      expect((await captureEvidence(launched.page)).worklets).toEqual([])
      expect((await captureEvidence(launched.page)).contextStates).toEqual([])
      await resolveLate(0)
      await expect.poll(trackStates).toEqual(['ended'])
      await panel.getByRole('button', { name: 'Cancel dictation', exact: true }).click()
      const cancelledAt = Date.now()
      await expect(draft).not.toHaveAttribute('readonly', '')
      await expect.poll(() => Date.now()).toBeGreaterThan(cancelledAt + 400)
      await panel.getByRole('button', { name: 'Start dictation', exact: true }).click()
      await expect.poll(pendingCount).toBe(2)
      await panel.getByRole('button', { name: 'Cancel dictation', exact: true }).click()
      await expect.poll(() => mock.connections[1]?.closed).toBe(true)
      await resolveLate(1)
      await expect.poll(trackStates).toEqual(['ended', 'ended'])
      await expect(draft).toHaveValue('Keep this original draft.')
      await expect(draft).not.toHaveAttribute('readonly', '')
      await draft.fill('Editing works after cancellation.')
      await expect(draft).toHaveValue('Editing works after cancellation.')
      expect(mock.connections.every((connection) => connection.frames.length === 0)).toBe(true)
      expect(mock.agentRequests).toHaveLength(0)
      expect((await captureEvidence(launched.page)).worklets).toEqual([])
      await launched.page.evaluate(async () => {
        const state = (window as unknown as { pendingSpeechCapture: { contexts: AudioContext[] } })
          .pendingSpeechCapture
        await Promise.all(state.contexts.map((context) => context.close()))
      })
    } finally {
      await launched.app.close()
      await mock.close()
    }
  }
)
