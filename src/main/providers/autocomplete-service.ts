import type { Logger } from 'pino'
import type {
  AutocompleteRequest,
  AutocompleteChange,
  AutocompleteCancelReason,
  AutocompleteResult,
  AutocompleteSelection,
  AutocompleteSession,
  AutocompleteStyle,
  AutocompleteSettings
} from '../../shared/contracts/autocomplete'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import { currentLogContext, withLogContext } from '../observability/log-context'
import type { AutocompleteGateway } from './autocomplete-client'

type Session = {
  enabled: boolean
  pending?: { requestId: string; controller: AbortController }
  delivered?: { requestId: string; sectionId: string; style: AutocompleteStyle }
}

export class AutocompleteService {
  readonly #sessions = new Map<string, Session>()
  #configurationVersion = 0
  #paused = false
  #retryAt = 0
  constructor(
    private readonly options: {
      settings: Pick<
        AppSettingsRepository,
        | 'getAutocompleteSelection'
        | 'setAutocompleteSelection'
        | 'getAutocompleteStyle'
        | 'setAutocompleteStyle'
      >
      credential(): Promise<string | null>
      gateway: AutocompleteGateway
      assertSection(projectSessionId: string, sectionId: string): void
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      changed(change: AutocompleteChange): void
      timeoutMs?: number
    }
  ) {}

  async settings(): Promise<AutocompleteSettings> {
    const selection = await this.options.settings.getAutocompleteSelection()
    return {
      selection,
      style: await this.options.settings.getAutocompleteStyle(),
      available: selection !== null && (await this.options.credential()) !== null
    }
  }
  async select(selection: AutocompleteSelection | null): Promise<AutocompleteSettings> {
    await this.options.settings.setAutocompleteSelection(selection)
    this.configurationChanged('model')
    this.options.log.info(
      { event: 'autocomplete.model_selected', modelId: selection?.modelId },
      'Autocomplete default changed'
    )
    return this.settings()
  }
  async setStyle(style: AutocompleteStyle): Promise<AutocompleteSettings> {
    await this.options.settings.setAutocompleteStyle(style)
    this.#configurationVersion++
    for (const id of this.#sessions.keys()) this.cancel(id, undefined, 'configuration')
    this.options.changed({ reason: 'style' })
    this.options.log.info(
      { event: 'autocomplete.style_changed', style },
      'Autocomplete style changed'
    )
    return this.settings()
  }
  async session(projectSessionId: string): Promise<AutocompleteSession> {
    const state = this.#sessions.get(projectSessionId)
    return { ...(await this.settings()), enabled: state?.enabled ?? false }
  }
  async toggle(projectSessionId: string, enabled: boolean): Promise<AutocompleteSession> {
    this.cancel(projectSessionId, undefined, enabled ? 'configuration' : 'disabled')
    const state: Session = { enabled: false }
    this.#sessions.set(projectSessionId, state)
    const settings = await this.settings()
    // Project close or a newer toggle may have revoked this pending enablement.
    if (this.#sessions.get(projectSessionId) === state)
      state.enabled = enabled && settings.available
    this.options.log.info(
      { event: 'autocomplete.toggled', projectSessionId, enabled: state.enabled },
      'Autocomplete session preference changed'
    )
    return { ...settings, enabled: state.enabled }
  }
  configurationChanged(reason: 'provider' | 'model' = 'provider'): void {
    this.#configurationVersion++
    this.#paused = false
    this.#retryAt = 0
    for (const id of this.#sessions.keys()) this.cancel(id, undefined, 'configuration')
    this.options.changed({ reason })
  }
  revokeSession(projectSessionId: string): void {
    this.cancel(projectSessionId, undefined, 'revoked')
    this.#sessions.delete(projectSessionId)
  }
  cancel(
    projectSessionId: string,
    requestId?: string,
    reason: AutocompleteCancelReason = 'superseded'
  ): void {
    const state = this.#sessions.get(projectSessionId)
    const activeId = state?.pending?.requestId ?? state?.delivered?.requestId
    if (activeId && (requestId === undefined || requestId === activeId)) {
      withLogContext({ requestId: activeId, projectSessionId }, () =>
        this.options.log.info(
          { event: 'autocomplete.cancel_requested', reason },
          'Autocomplete invalidated'
        )
      )
    }
    if (state?.pending && (requestId === undefined || state.pending.requestId === requestId)) {
      state.pending.controller.abort()
      state.pending = undefined
    }
    if (state?.delivered && (requestId === undefined || state.delivered.requestId === requestId))
      state.delivered = undefined
  }
  accepted(projectSessionId: string, requestId: string): void {
    const state = this.#sessions.get(projectSessionId)
    if (state?.delivered?.requestId !== requestId || !state.enabled) return
    this.options.assertSection(projectSessionId, state.delivered.sectionId)
    this.options.log.info(
      {
        event: 'autocomplete.accepted',
        projectSessionId,
        requestId,
        sectionId: state.delivered.sectionId,
        style: state.delivered.style
      },
      'Autocomplete suggestion accepted'
    )
    state.delivered = undefined
  }
  complete(input: AutocompleteRequest): Promise<AutocompleteResult> {
    return withLogContext(
      {
        requestId: input.requestId,
        projectSessionId: input.projectSessionId,
        sectionId: input.sectionId
      },
      () => this.#complete(input)
    )
  }
  async #complete(input: AutocompleteRequest): Promise<AutocompleteResult> {
    const result = (
      status: AutocompleteResult['status'],
      text = '',
      retryAt?: number
    ): AutocompleteResult => ({
      requestId: input.requestId,
      generation: input.generation,
      status,
      text,
      ...(retryAt === undefined ? {} : { retryAt })
    })
    const state = this.#sessions.get(input.projectSessionId)
    if (!state?.enabled) return result('unavailable')
    this.cancel(input.projectSessionId)
    if (this.#paused) return result('paused')
    if (Date.now() < this.#retryAt) return result('cooldown', '', this.#retryAt)
    this.options.assertSection(input.projectSessionId, input.sectionId)
    const controller = new AbortController()
    const pending = { requestId: input.requestId, controller }
    state.pending = pending
    const version = this.#configurationVersion
    const startedAt = Date.now()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.options.timeoutMs ?? 10_000)
    const current = () =>
      !controller.signal.aborted &&
      state.enabled &&
      state.pending === pending &&
      this.#sessions.get(input.projectSessionId) === state &&
      version === this.#configurationVersion
    try {
      const selection = await this.options.settings.getAutocompleteSelection()
      const style = await this.options.settings.getAutocompleteStyle()
      const credential = selection === null ? null : await this.options.credential()
      if (!current()) return result('cancelled')
      if (selection === null || credential === null) return result('unavailable')
      this.options.assertSection(input.projectSessionId, input.sectionId)
      this.options.log.info(
        {
          event: 'autocomplete.started',
          mode: input.atBlockEnd ? 'prefix' : 'fim',
          style,
          trigger: input.trigger ?? 'edit'
        },
        'Autocomplete request started'
      )
      const response = await this.options.gateway.complete(
        {
          operation: 'autocomplete',
          requestId: input.requestId,
          projectSessionId: input.projectSessionId,
          context: currentLogContext(),
          modelId: selection.modelId,
          style,
          credential,
          input
        },
        controller.signal
      )
      if (!current()) return result('cancelled')
      this.options.assertSection(input.projectSessionId, input.sectionId)
      if (response.error) {
        const err = Object.assign(new Error(response.error.message), {
          name: response.error.name,
          stack: response.error.stack
        })
        this.options.log.error(
          { event: 'autocomplete.failed', err, httpStatus: response.error.httpStatus },
          'Autocomplete provider failed'
        )
        if ([401, 403].includes(response.error.httpStatus ?? 0)) {
          this.#paused = true
          return result('paused')
        }
        if (response.error.httpStatus === 429) {
          this.#retryAt = Math.max(Date.now() + 30_000, response.error.retryAt ?? 0)
          return result('cooldown', '', this.#retryAt)
        }
        return result('failed')
      }
      if (response.text.trim().length > 0)
        state.delivered = { requestId: input.requestId, sectionId: input.sectionId, style }
      this.options.log.info(
        {
          event: 'autocomplete.completed',
          durationMs: Date.now() - startedAt,
          modelId: selection.modelId,
          style,
          originalCharacters: response.originalCharacters,
          displayedCharacters: response.displayedCharacters,
          usage: response.usage,
          suggested: state.delivered !== undefined
        },
        'Autocomplete request completed'
      )
      return state.delivered ? result('suggestion', response.text) : result('empty')
    } catch (err) {
      this.options.log[controller.signal.aborted ? 'info' : 'error'](
        {
          event: controller.signal.aborted ? 'autocomplete.cancelled' : 'autocomplete.failed',
          err,
          durationMs: Date.now() - startedAt,
          timedOut
        },
        'Autocomplete request ended'
      )
      return result(timedOut ? 'failed' : current() ? 'failed' : 'cancelled')
    } finally {
      clearTimeout(timeout)
      if (state.pending === pending) state.pending = undefined
    }
  }
}
