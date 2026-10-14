import type { AgentSessionServiceOptions } from './session-service'
import type { AgentSessionRecord } from '../../shared/contracts/agent-ipc'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { AgentTraceRepository } from './trace-repository'
import {
  buildSessionTitleContext,
  sanitizeGeneratedSessionTitle,
  type SessionTitleMessage
} from './session-title'
import { formatSessionTitleInput, SESSION_TITLE_SYSTEM_PROMPT } from './prompts/task-prompts'

const SESSION_TITLE_OUTPUT_TOKENS = 64
const SESSION_TITLE_REASONING_OUTPUT_TOKENS = 512

type TitleOptions = Pick<
  AgentSessionServiceOptions,
  'database' | 'log' | 'projectSessionId' | 'generateTitle'
> & {
  now: () => Date
  createId: () => string
  requireSession: (agentSessionId: string) => AgentSessionRecord
  publishSession: (session: AgentSessionRecord, titleGenerating: boolean) => Promise<void>
}

export class AgentSessionTitles {
  readonly #titleRequests = new Map<
    string,
    { controller: AbortController; completion: Promise<AgentSessionRecord> }
  >()
  constructor(private readonly options: TitleOptions) {}

  has(agentSessionId: string): boolean {
    return this.#titleRequests.has(agentSessionId)
  }

  abortAll(): Promise<unknown>[] {
    const requests = [...this.#titleRequests.values()]
    for (const request of requests) request.controller.abort(new Error('Project is closing'))
    return requests.map((request) => request.completion)
  }
  begin(input: {
    agentSessionId: string
    agentRunId: string
    operationId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    context: string
    expectedTitle: string
    controller: AbortController
    automatic: boolean
    reasoningModel: boolean
  }): Promise<AgentSessionRecord> {
    if (this.#titleRequests.has(input.agentSessionId)) {
      return Promise.reject(new Error('Conversation title is already being generated'))
    }
    const completion = this.execute(input)
    return this.track(input.agentSessionId, input.controller, completion)
  }

  track(
    agentSessionId: string,
    controller: AbortController,
    completion: Promise<AgentSessionRecord>
  ): Promise<AgentSessionRecord> {
    if (this.#titleRequests.has(agentSessionId)) {
      controller.abort(new Error('Conversation title is already being generated'))
      return Promise.reject(new Error('Conversation title is already being generated'))
    }
    this.#titleRequests.set(agentSessionId, { controller, completion })
    void completion
      .finally(() => {
        const active = this.#titleRequests.get(agentSessionId)
        if (active?.completion === completion) this.#titleRequests.delete(agentSessionId)
      })
      .catch(() => undefined)
    return completion
  }

  async execute(input: {
    agentSessionId: string
    agentRunId: string
    operationId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    context: string
    expectedTitle: string
    controller: AbortController
    automatic: boolean
    reasoningModel: boolean
  }): Promise<AgentSessionRecord> {
    const generate = this.options.generateTitle
    if (generate === undefined) return this.options.requireSession(input.agentSessionId)
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.options.now,
      this.options.createId
    )
    let modelRequestId: string | undefined
    const startedAt = Date.now()
    try {
      modelRequestId = (
        await repository.start({
          operation: 'agent',
          provider: input.config,
          request: {
            purpose: 'session_title',
            systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
            context: input.context
          },
          inputItems: 1,
          operationId: input.operationId,
          agentRunId: input.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
      this.options.log.info(
        {
          event: 'agent.session.title_generation_started',
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          inputCharacters: Array.from(input.context).length
        },
        'Agent session title generation started'
      )
      const result = await generate({
        modelRequestId,
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        operationId: input.operationId,
        config: input.config,
        credential: input.credential,
        request: {
          systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
          prompt: formatSessionTitleInput(input.context),
          maxOutputTokens: input.reasoningModel
            ? SESSION_TITLE_REASONING_OUTPUT_TOKENS
            : SESSION_TITLE_OUTPUT_TOKENS,
          ...(input.reasoningModel ? {} : { temperature: 0 })
        },
        modelLimits: input.modelLimits,
        signal: input.controller.signal
      })
      const title = sanitizeGeneratedSessionTitle(result.text)
      if (title.length === 0) throw new Error('Agent title model returned an empty title')
      await repository.succeed(modelRequestId, {
        metadata: result.metadata,
        outputItems: 1
      })
      const trace = new AgentTraceRepository(
        this.options.database,
        this.options.log,
        this.options.now,
        this.options.createId
      )
      if (trace.exists(modelRequestId)) {
        trace.complete({
          modelRequestId,
          physicalAttemptCount: result.metadata.retryCount + 1
        })
      }
      const now = this.options.now().toISOString()
      const changes = this.options.database.immediate(
        (database) =>
          database
            .prepare(
              `UPDATE agent_sessions
                SET title = ?, updated_at = ?
              WHERE agent_session_id = ? AND status = 'active' AND title = ?`
            )
            .run(title, now, input.agentSessionId, input.expectedTitle).changes
      )
      const session = this.options.requireSession(input.agentSessionId)
      this.options.log.info(
        {
          event:
            changes === 1
              ? 'agent.session.title_generation_completed'
              : 'agent.session.title_generation_superseded',
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          outputCharacters: Array.from(title).length,
          durationMs: Date.now() - startedAt
        },
        changes === 1
          ? 'Agent session title generation completed'
          : 'Agent session title generation was superseded by newer state'
      )
      await this.options.publishSession(session, false)
      return session
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.session.title_generation_failed',
          err,
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          durationMs: Date.now() - startedAt
        },
        'Agent session title generation failed'
      )
      if (modelRequestId !== undefined) {
        try {
          if (input.controller.signal.aborted) {
            await repository.abort(modelRequestId, 'session_title_cancelled')
          } else {
            await repository.fail(modelRequestId, {
              code: 'session_title_failed',
              retryable: false
            })
          }
        } catch (recordErr) {
          this.options.log.error(
            {
              event: 'agent.session.title_generation_record_failed',
              err: recordErr,
              agentSessionId: input.agentSessionId,
              modelRequestId
            },
            'Failed to record Agent session title request outcome'
          )
        }
        const trace = new AgentTraceRepository(
          this.options.database,
          this.options.log,
          this.options.now,
          this.options.createId
        )
        if (trace.exists(modelRequestId)) {
          trace.fail({
            modelRequestId,
            physicalAttemptCount: 1,
            failureCode:
              err instanceof Error && 'code' in err && typeof err.code === 'string'
                ? err.code
                : 'session_title_failed'
          })
        }
      }
      const session = this.options.requireSession(input.agentSessionId)
      await this.options.publishSession(session, false)
      if (input.automatic) return session
      throw new Error('Conversation title could not be generated', { cause: err })
    }
  }

  loadContext(agentSessionId: string): string {
    const rows = this.options.database.read((database) => {
      const first = database
        .prepare(
          `SELECT sequence, 'user' AS role,
                  substr(json_extract(payload_json, '$.content'), 1, 16384) AS content
             FROM agent_conversation_history
            WHERE agent_session_id = ? AND type = 'user_message'
            ORDER BY sequence
            LIMIT 1`
        )
        .get(agentSessionId) as SessionTitleMessage | undefined
      const summary = database
        .prepare(
          `SELECT sequence, 'summary' AS role,
                  substr(json_extract(payload_json, '$.summary'), 1, 16384) AS content
             FROM agent_conversation_history
            WHERE agent_session_id = ? AND type = 'compaction_summary'
            ORDER BY sequence DESC
            LIMIT 1`
        )
        .get(agentSessionId) as SessionTitleMessage | undefined
      const recent = database
        .prepare(
          `SELECT sequence,
                  CASE type WHEN 'user_message' THEN 'user' ELSE 'assistant' END AS role,
                  substr(json_extract(payload_json, '$.content'), 1, 16384) AS content
             FROM agent_conversation_history
            WHERE agent_session_id = ? AND type IN ('user_message', 'assistant_message')
            ORDER BY sequence DESC
            LIMIT 24`
        )
        .all(agentSessionId) as SessionTitleMessage[]
      return [first, summary, ...recent.reverse()].filter(
        (row): row is SessionTitleMessage =>
          row !== undefined && typeof row.content === 'string' && row.content.length > 0
      )
    })
    return buildSessionTitleContext(rows)
  }
}
