import { speechSourceIdSchema } from './providers'
import { SPEECH_PROVIDER_CODES, SPEECH_PROVIDER_PARAMS } from '../speech-errors'
import { logContextSchema } from '../observability/log-schema'
import { z } from 'zod'
import { defineIpcEndpoint, type IpcEndpointApi } from './ipc-endpoints'

export const SPEECH_LIMITS = Object.freeze({
  sampleRate: 24000,
  channels: 1,
  maxDurationMs: 120000,
  maxFrameBytes: 4800,
  maxAudioBytes: 5760000,
  maxTextBytes: 65536
})
export const speechModeSchema = z.enum(['realtime', 'file'])
export const speechProjectSchema = z.object({ projectSessionId: z.uuid() }).strict()
export const speechIdentitySchema = speechProjectSchema.extend({ recognitionId: z.uuid() }).strict()
export const speechPcmSchema = z.custom<Uint8Array>(
  (value) =>
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Uint8Array]' &&
    value.byteLength > 0 &&
    value.byteLength <= SPEECH_LIMITS.maxFrameBytes &&
    value.byteLength % 2 === 0,
  'Invalid PCM16 frame'
)
export const speechAudioSchema = speechIdentitySchema
  .extend({ sequence: z.number().int().nonnegative(), pcm: speechPcmSchema })
  .strict()
export const speechStartResultSchema = z
  .object({
    recognitionId: z.uuid(),
    mode: speechModeSchema,
    sampleRate: z.literal(24000),
    channels: z.literal(1),
    maxDurationMs: z.literal(120000),
    maxFrameBytes: z.literal(4800)
  })
  .strict()
export const speechEventSchema = speechIdentitySchema
  .extend({
    sequence: z.number().int().nonnegative(),
    state: z.enum(['recording', 'partial', 'final', 'error']),
    text: z
      .string()
      .max(65536)
      .refine((value) => new TextEncoder().encode(value).byteLength <= SPEECH_LIMITS.maxTextBytes)
      .optional(),
    error: z.string().max(500).optional(),
    errorCode: z.enum(SPEECH_PROVIDER_CODES).optional(),
    errorParam: z.enum(SPEECH_PROVIDER_PARAMS).optional()
  })
  .strict()
export type SpeechEvent = z.infer<typeof speechEventSchema>
export type SpeechStartResult = z.infer<typeof speechStartResultSchema>
export type SpeechAudio = z.infer<typeof speechAudioSchema>
export const speechIpcEndpoints = {
  start: defineIpcEndpoint({
    channel: 'speech:start',
    input: speechProjectSchema,
    output: speechStartResultSchema,
    session: 'active'
  }),
  pushAudio: defineIpcEndpoint({
    channel: 'speech:audio',
    input: speechAudioSchema,
    output: z.void(),
    session: 'active'
  }),
  finish: defineIpcEndpoint({
    channel: 'speech:finish',
    input: speechIdentitySchema,
    output: z.void(),
    session: 'active'
  }),
  cancel: defineIpcEndpoint({
    channel: 'speech:cancel',
    input: speechIdentitySchema,
    output: z.void(),
    session: 'active'
  }),
  testConnection: defineIpcEndpoint({
    channel: 'speech:test',
    input: z.object({ sourceId: speechSourceIdSchema }).strict().optional(),
    output: z.void(),
    session: 'none'
  }),
  cancelTest: defineIpcEndpoint({
    channel: 'speech:cancel-test',
    input: z.undefined(),
    output: z.void(),
    session: 'none'
  })
} as const
export type SpeechApi = IpcEndpointApi<typeof speechIpcEndpoints> & {
  subscribe(listener: (event: SpeechEvent) => void): () => void
}

export const speechWorkerStartSchema = z
  .object({
    type: z.literal('speech-start'),
    context: logContextSchema.optional(),
    requestId: z.uuid(),
    projectSessionId: z.uuid().nullable(),
    config: z
      .object({ baseUrl: z.string(), model: z.string().min(1).max(200), mode: speechModeSchema })
      .strict(),
    credential: z.string().max(16384).optional(),
    test: z.boolean()
  })
  .strict()
export type SpeechWorkerStart = z.infer<typeof speechWorkerStartSchema>
export const speechWorkerCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('speech-audio'),
      requestId: z.uuid(),
      projectSessionId: z.uuid(),
      sequence: z.number().int().nonnegative(),
      pcm: speechPcmSchema
    })
    .strict(),
  z
    .object({ type: z.literal('speech-finish'), requestId: z.uuid(), projectSessionId: z.uuid() })
    .strict(),
  z
    .object({
      type: z.literal('speech-cancel'),
      requestId: z.uuid(),
      projectSessionId: z.uuid().nullable()
    })
    .strict()
])
export type SpeechWorkerCommand = z.infer<typeof speechWorkerCommandSchema>
export const speechWorkerEventSchema = z
  .object({
    type: z.literal('speech-event'),
    requestId: z.uuid(),
    projectSessionId: z.uuid().nullable(),
    state: z.enum(['ready', 'partial', 'final', 'error']),
    text: z
      .string()
      .max(65536)
      .refine((value) => new TextEncoder().encode(value).byteLength <= SPEECH_LIMITS.maxTextBytes)
      .optional(),
    error: z.string().max(500).optional(),
    errorCode: z.enum(SPEECH_PROVIDER_CODES).optional(),
    errorParam: z.enum(SPEECH_PROVIDER_PARAMS).optional()
  })
  .strict()
export type SpeechWorkerEvent = z.infer<typeof speechWorkerEventSchema>
