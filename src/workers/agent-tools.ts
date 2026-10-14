import { randomUUID } from 'node:crypto'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { MessagePortMain } from 'electron'
import {
  agentToolRequestSchema,
  agentToolResponseSchema,
  AGENT_TOOL_DESCRIPTORS,
  type AgentToolName,
  type AgentToolResponse
} from '../shared/contracts/agent-tools'
import { agentModelVisibleToolSpecs } from '../shared/agent-tool-specs'
import type {
  AgentInteractionMode,
  AgentToolProfile,
  WritingToolGroup
} from '../shared/contracts/agent'

interface PendingToolRequest {
  readonly toolName: AgentToolName
  readonly toolCallId: string
  readonly modelRequestId: string
  readonly resolve: (response: AgentToolResponse) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  readonly onAbort?: () => void
}

export class AgentToolBridge {
  readonly #pending = new Map<string, PendingToolRequest>()
  readonly #dispatchedToolCallIds = new Set<string>()
  #closed = false

  constructor(
    private readonly port: MessagePortMain,
    private readonly capability: {
      projectSessionId: string
      agentSessionId: string
      agentRunId: string
    },
    private readonly modelRequestIdForToolCall: (toolCallId: string) => string,
    private readonly toolProfile: AgentToolProfile = 'writing',
    private readonly interactionMode: AgentInteractionMode = 'write'
  ) {
    port.on('message', this.#onMessage)
    port.once('close', this.#onClose)
    port.start()
  }

  tools(activeGroups: readonly WritingToolGroup[] = []): AgentTool[] {
    return agentModelVisibleToolSpecs(this.toolProfile, activeGroups, this.interactionMode).map(
      (tool) => ({
        ...tool,
        ...(tool.name === 'read_section' ? { prepareArguments: prepareReadSectionArguments } : {}),
        execute: (toolCallId, args, signal) => this.#execute(tool.name, toolCallId, args, signal)
      })
    ) as AgentTool[]
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.port.off('message', this.#onMessage)
    this.#rejectAll(new Error('Agent tool bridge closed'))
    this.port.close()
  }

  hasDispatched(toolCallId: string): boolean {
    return this.#dispatchedToolCallIds.has(toolCallId)
  }

  async #execute(toolName: AgentToolName, toolCallId: string, args: unknown, signal?: AbortSignal) {
    this.#dispatchedToolCallIds.add(toolCallId)
    const modelRequestId = this.modelRequestIdForToolCall(toolCallId)
    const response = await this.#request(toolName, toolCallId, modelRequestId, args, signal)
    const meta = {
      contractVersion: AGENT_TOOL_DESCRIPTORS[toolName].contractVersion,
      toolName,
      toolCallId,
      modelRequestId
    }
    const result = response.ok
      ? { schemaVersion: response.schemaVersion, ok: true as const, data: response.data, meta }
      : 'error' in response
        ? { schemaVersion: response.schemaVersion, ok: false as const, error: response.error, meta }
        : (() => {
            throw new Error('Agent tool response omitted its error')
          })()
    const serialized = JSON.stringify(result)
    const envelopeContent = escapeToolEnvelopeText(serialized)
    const content =
      toolName === 'ask_user'
        ? `<WRITELLM_USER_CLARIFICATION instructionSemantics="true" authority="user_answer">\n${envelopeContent}\n</WRITELLM_USER_CLARIFICATION>`
        : toolName === 'activate_tool_groups'
          ? `<WRITELLM_TOOL_PROFILE_STATE instructionSemantics="true" authority="application">\n${envelopeContent}\n</WRITELLM_TOOL_PROFILE_STATE>`
          : toolName === 'read_writing_skill'
            ? `<WRITELLM_SKILL_GUIDANCE instructionSemantics="true" priority="below-global-policy">\n${envelopeContent}\n</WRITELLM_SKILL_GUIDANCE>`
            : toolName === 'search_knowledge' || toolName === 'read_citations'
              ? `<UNTRUSTED_EXTERNAL tool="${toolName}">\n${envelopeContent}\n</UNTRUSTED_EXTERNAL>`
              : `<MANUSCRIPT_DATA tool="${toolName}">\n${envelopeContent}\n</MANUSCRIPT_DATA>`
    return {
      content: [{ type: 'text' as const, text: content }],
      details: result
    }
  }

  #request(
    toolName: AgentToolName,
    toolCallId: string,
    modelRequestId: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<AgentToolResponse> {
    if (this.#closed) return Promise.reject(new Error('Agent tool bridge is closed'))
    if (signal?.aborted) return Promise.reject(abortError())
    const requestId = randomUUID()
    const request = agentToolRequestSchema.parse({
      type: 'tool_request',
      requestId,
      ...this.capability,
      toolCallId,
      modelRequestId,
      toolName,
      args
    })
    return new Promise((resolve, reject) => {
      const onAbort =
        signal === undefined
          ? undefined
          : () => {
              this.#finish(requestId)
              reject(abortError())
            }
      this.#pending.set(requestId, {
        toolName,
        toolCallId,
        modelRequestId,
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
        ...(onAbort === undefined ? {} : { onAbort })
      })
      signal?.addEventListener('abort', onAbort as () => void, { once: true })
      try {
        this.port.postMessage(request)
      } catch (err) {
        this.#finish(requestId)
        reject(new Error('Agent tool request could not be sent', { cause: err }))
      }
    })
  }

  readonly #onMessage = (event: Electron.MessageEvent): void => {
    const parsed = agentToolResponseSchema.safeParse(event.data)
    if (!parsed.success) {
      this.#rejectAll(new Error('Agent tool bridge returned an invalid response'))
      this.close()
      return
    }
    const response = parsed.data
    const pending = this.#pending.get(response.requestId)
    if (pending === undefined) return
    if (
      response.projectSessionId !== this.capability.projectSessionId ||
      response.agentSessionId !== this.capability.agentSessionId ||
      response.agentRunId !== this.capability.agentRunId ||
      response.toolCallId !== pending.toolCallId ||
      response.toolName !== pending.toolName ||
      response.modelRequestId !== pending.modelRequestId
    ) {
      this.#rejectAll(new Error('Agent tool response capability mismatch'))
      this.close()
      return
    }
    this.#finish(response.requestId)
    pending.resolve(response)
  }

  readonly #onClose = (): void => {
    this.#closed = true
    this.#rejectAll(new Error('Agent tool bridge closed'))
  }

  #finish(requestId: string): void {
    const pending = this.#pending.get(requestId)
    if (pending === undefined) return
    this.#pending.delete(requestId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
  }

  #rejectAll(error: Error): void {
    for (const [requestId, pending] of this.#pending) {
      this.#finish(requestId)
      pending.reject(error)
    }
  }
}

function prepareReadSectionArguments(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const record = args as Record<string, unknown>
  if (record.view !== 'canonical' || 'blockId' in record) return args
  return { ...record, view: 'summary' }
}

function escapeToolEnvelopeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function abortError(): Error {
  const error = new Error('Agent tool request aborted')
  error.name = 'AbortError'
  return error
}
