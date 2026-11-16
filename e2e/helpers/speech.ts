import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication, Page } from '@playwright/test'
import { WebSocketServer, type WebSocket } from 'ws'

export interface SpeechMockConnection {
  socket: WebSocket
  frames: number[]
  commits: number
  closed: boolean
  finalText: string
  authorization: string | undefined
  model: string | undefined
}

/** Loopback only. Holds final responses so the scenario controls every transition. */
export async function startSpeechMock() {
  const connections: SpeechMockConnection[] = []
  const files: Array<{ bytes: Buffer; response: ServerResponse }> = []
  const agentRequests: Array<{ body: string; response: ServerResponse }> = []
  const modelRequests: Array<{ authorization: string | undefined }> = []
  let modelCandidates = [{ id: 'writer-model', name: 'Writer model' }]
  let modelStatus = 200
  let acceptSessions = true
  let rejectNextSession = false
  const server = createServer((request, response) => {
    if (request.url === '/v1/models') {
      modelRequests.push({ authorization: request.headers.authorization })
      response.writeHead(modelStatus, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(
          modelStatus === 200
            ? { data: modelCandidates.map(({ id, name }) => ({ id, displayName: name })) }
            : { error: 'fixture failure' }
        )
      )
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const bytes = Buffer.concat(chunks)
      if (request.url === '/v1/audio/transcriptions') {
        files.push({ bytes, response })
        return
      }
      if (request.url === '/v1/chat/completions') {
        const body = bytes.toString()
        if (body.includes('Create a concise title for the delimited'))
          completeSpeechAgent(response, 'Speech draft')
        else agentRequests.push({ body, response })
        return
      }
      response.writeHead(404)
      response.end()
    })
  })
  const websocket = new WebSocketServer({ server, path: '/v1/realtime' })
  websocket.on('connection', (socket, request) => {
    const connection: SpeechMockConnection = {
      socket,
      frames: [],
      commits: 0,
      closed: false,
      finalText: '研究背景终稿',
      authorization: request.headers.authorization,
      model: undefined
    }
    connections.push(connection)
    socket.on('close', () => {
      connection.closed = true
    })
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as {
        type: string
        audio?: string
        session?: { audio?: { input?: { transcription?: { model?: string } } } }
      }
      if (event.type === 'session.update')
        connection.model = event.session?.audio?.input?.transcription?.model
      if (event.type === 'session.update' && rejectNextSession) {
        rejectNextSession = false
        socket.send(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              code: 'invalid_parameter',
              param: 'session.audio.input.transcription.languages',
              message: 'private diagnostic must not reach the UI'
            }
          })
        )
        return
      }
      if (event.type === 'session.update' && acceptSessions)
        socket.send(JSON.stringify({ type: 'session.updated' }))
      if (event.type === 'input_audio_buffer.append') {
        connection.frames.push(Buffer.from(event.audio ?? '', 'base64').byteLength)
        if (connection.frames.length === 1)
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'utterance',
              delta: '研究背景预览'
            })
          )
      }
      if (event.type === 'input_audio_buffer.commit') connection.commits++
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  return {
    baseUrl,
    connections,
    files,
    agentRequests,
    modelRequests,
    setModels(models: Array<{ id: string; name: string }>, status = 200) {
      modelCandidates = models
      modelStatus = status
    },
    rejectConfiguration: () => {
      rejectNextSession = true
    },
    holdSessions: () => {
      acceptSessions = false
    },
    complete(connection: SpeechMockConnection) {
      connection.socket.send(
        JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'utterance' })
      )
      connection.socket.send(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'utterance',
          transcript: connection.finalText
        })
      )
    },
    async close() {
      for (const connection of connections) connection.socket.terminate()
      for (const { response } of files) response.destroy()
      for (const { response } of agentRequests) response.destroy()
      server.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve, reject) =>
          websocket.close((err) => (err ? reject(err) : resolve()))
        ),
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        )
      ])
    }
  }
}

export function completeSpeechAgent(response: ServerResponse, text: string): void {
  if (response.destroyed) return
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(
    `data: ${JSON.stringify({ id: 'speech-agent', object: 'chat.completion.chunk', created: 1, model: 'writer-model', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`
  )
}

export async function configureSpeech(
  page: Page,
  baseUrl: string,
  mode: 'realtime' | 'file'
): Promise<void> {
  await page.evaluate(
    async ({ baseUrl, mode }) => {
      const before = await window.desktop.providers.snapshot()
      const existing = before.speechCatalog.sources.find((source) => source.name === 'Speech test')
      const saved = await window.desktop.providers.saveSpeechSource({
        ...(existing ? { sourceId: existing.sourceId } : {}),
        source: { name: 'Speech test', baseUrl, model: 'speech-model', mode }
      })
      const source = saved.speechCatalog.sources.find((item) => item.name === 'Speech test')
      if (!source) throw new Error('Speech test source missing')
      await window.desktop.providers.setActiveSpeechSource({ sourceId: source.sourceId })
    },
    { baseUrl, mode }
  )
}

export async function prepareSyntheticMicrophone(
  app: ElectronApplication,
  page: Page
): Promise<void> {
  await app.evaluate(({ app, systemPreferences }) => {
    if (
      !app.commandLine.hasSwitch('use-fake-device-for-media-stream') ||
      !app.commandLine.hasSwitch('use-fake-ui-for-media-stream')
    )
      throw new Error('Synthetic audio flags missing')
    // OS permission is separately unit-tested. Never request a physical device in this suite.
    systemPreferences.getMediaAccessStatus = () => 'granted'
    systemPreferences.askForMediaAccess = async () => {
      throw new Error('Physical microphone access is forbidden in synthetic speech E2E')
    }
  })
  await page.evaluate(() => {
    const state = {
      requests: 0,
      tracks: [] as MediaStreamTrack[],
      worklets: [] as string[],
      stages: [] as string[],
      contexts: [] as AudioContext[]
    }
    Object.assign(window, { speechCaptureEvidence: state })
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.requests++
      state.stages.push(`get-user-media:requested:activation-${navigator.userActivation.isActive}`)
      const stream = await original(constraints)
      state.stages.push('get-user-media:resolved')
      state.tracks.push(...stream.getTracks())
      return stream
    }
    const OriginalContext = AudioContext
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options)
        state.contexts.push(this)
        state.stages.push(`context:created:${this.state}`)
      }
      override async resume(): Promise<void> {
        state.stages.push(
          `context:resume:${this.state}:activation-${navigator.userActivation.isActive}`
        )
        await super.resume()
        state.stages.push(`context:resumed:${this.state}`)
      }
    }
    const addModule = AudioWorklet.prototype.addModule
    AudioWorklet.prototype.addModule = async function (url, options) {
      state.worklets.push(String(url))
      state.stages.push('worklet:requested')
      await addModule.call(this, url, options)
      state.stages.push('worklet:resolved')
    }
  })
}

export async function captureEvidence(page: Page) {
  return page.evaluate(() => {
    const state = (
      window as unknown as {
        speechCaptureEvidence: {
          requests: number
          tracks: MediaStreamTrack[]
          worklets: string[]
          stages: string[]
          contexts: AudioContext[]
        }
      }
    ).speechCaptureEvidence
    return {
      requests: state.requests,
      tracks: state.tracks.map((track) => track.readyState),
      worklets: state.worklets,
      origin: location.origin,
      stages: state.stages,
      contextStates: state.contexts.map((context) => context.state),
      visibility: document.visibilityState,
      focused: document.hasFocus()
    }
  })
}
