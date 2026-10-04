import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  agentAttachmentIdsSchema,
  agentImageContentSchema,
  AGENT_IMAGE_MAX_BASE64,
  agentMessageTextBytes,
  imageDataBytes
} from './contracts/agent-attachments'
import { agentHistorySchema, agentUserMessagePayloadSchema } from './contracts/agent'
import { estimateAgentTokens, AgentContextBudgetController } from './agent-context-budget'
import { redactTraceImages } from './trace-image-redaction'

const image = {
  type: 'image' as const,
  data: 'AAAA',
  mimeType: 'image/png' as const,
  sha256: 'a'.repeat(64),
  width: 1,
  height: 1
}

describe('Agent image contracts and context budgets', () => {
  it('accepts image-only events and rejects empty or excessive attachments', () => {
    const attachmentIds = [randomUUID()]
    expect(
      agentUserMessagePayloadSchema.parse({
        content: '',
        attachmentIds,
        delivery: 'prompt',
        timestamp: 0
      }).attachmentIds
    ).toEqual(attachmentIds)
    expect(
      agentUserMessagePayloadSchema.safeParse({ content: '', delivery: 'prompt', timestamp: 0 })
        .success
    ).toBe(false)
    expect(
      agentAttachmentIdsSchema.safeParse(Array.from({ length: 5 }, () => randomUUID())).success
    ).toBe(false)
    expect(agentAttachmentIdsSchema.safeParse([attachmentIds[0], attachmentIds[0]]).success).toBe(
      false
    )
    expect(agentImageContentSchema.safeParse({ ...image, width: 2001 }).success).toBe(false)
  })
  it('counts Pi image tokens and separates image bytes from text metadata', () => {
    const large = { ...image, data: 'A'.repeat(AGENT_IMAGE_MAX_BASE64 - 4) }
    const history = [
      {
        role: 'user' as const,
        content: 'Describe',
        images: [large, large, large, large],
        timestamp: 0
      }
    ]
    expect(agentHistorySchema.safeParse(history).success).toBe(true)
    expect(imageDataBytes(history)).toBeGreaterThan(2 * 1024 * 1024)
    expect(agentMessageTextBytes(history)).toBeLessThan(2000)
    expect(estimateAgentTokens(history)).toBeGreaterThan(4 * 1200)
    expect(estimateAgentTokens({ ...history[0], images: [image, image, image, image] })).toBe(
      estimateAgentTokens(history)
    )
    expect(agentHistorySchema.safeParse([...history, ...history]).success).toBe(false)
    const controller = new AgentContextBudgetController(100000)
    expect(() =>
      controller.transform([
        { role: 'user', content: Array.from({ length: 8 }, () => large), timestamp: 0 }
      ])
    ).toThrow('32 MiB')
  })
  it('redacts Pi, OpenAI, Anthropic and Gemini image payloads at the trace boundary', () => {
    const source = {
      pi: image,
      openai: { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      anthropic: { source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      gemini: { inlineData: { mimeType: 'image/png', data: 'AAAA' } }
    }
    const redacted = JSON.stringify(redactTraceImages(source))
    expect(redacted).not.toContain('AAAA')
    expect(redacted).not.toContain('data:image')
    expect(redacted.match(/imageRedacted/g)).toHaveLength(4)
    expect(redacted).toContain('sha256')
  })
})
