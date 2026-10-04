import { randomUUID } from 'node:crypto'
import {
  agentImageProcessRequestSchema,
  agentImageProcessResultSchema,
  type AgentImageContent
} from '../../shared/contracts/agent-attachments'
import type { PersistentUtilityProcess } from '../workers/persistent-utility-process'

export class AgentImageProcessClient {
  constructor(private readonly worker: PersistentUtilityProcess) {}

  process(
    bytes: Buffer,
    mimeType: string,
    projectSessionId: string,
    signal: AbortSignal
  ): Promise<AgentImageContent> {
    const requestId = randomUUID()
    return this.worker.request({
      requestId,
      signal,
      rejectOnAbort: new Error('Image import was cancelled'),
      payload: agentImageProcessRequestSchema.parse({
        operation: 'process_agent_image',
        requestId,
        projectSessionId,
        dataBase64: bytes.toString('base64'),
        mimeType
      }),
      onMessage(raw) {
        const parsed = agentImageProcessResultSchema.safeParse(raw)
        if (
          !parsed.success ||
          parsed.data.requestId !== requestId ||
          parsed.data.projectSessionId !== projectSessionId
        ) {
          return {
            kind: 'reject',
            error: new Error('Image worker response is invalid'),
            terminate: true
          }
        }
        if (parsed.data.type === 'agent-image-error')
          return { kind: 'reject', error: new Error(parsed.data.error.message) }
        return { kind: 'resolve', value: parsed.data.image }
      }
    })
  }
}
