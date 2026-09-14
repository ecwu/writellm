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
  pending?: { requestId: string; controller: AbortController }
  delivered?: { requestId: string; sectionId: string; style: AutocompleteStyle }
}

export class AutocompleteService {
  readonly #sessions = new Map<string, Session>()
  #enabledOverride: boolean | undefined
  #styleOverride: AutocompleteStyle | undefined
  #configurationVersion = 0
  #paused = false
  #retryAt = 0
  constructor(
    private readonly options: {
      settings: Pick<
        AppSettingsRepository,
        | 'getAutocompleteDefaultEnabled'
        | 'setAutocompleteDefaultEnabled'
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
      defaultEnabled: await this.options.settings.getAutocompleteDefaultEnabled(),
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
    if (this.#styleOverride === undefined) this.#preferencesChanged('style')
    this.options.log.info(
      { event: 'autocomplete.style_changed', style },
      'Autocomplete style changed'
    )
    return this.settings()
  }
  #preferencesChanged(reason: 'style' | 'toggle'): void {
    this.#configurationVersion++
    for (const id of this.#sessions.keys()) this.cancel(id, undefined, 'configuration')
    this.options.changed({ reason })
  }
  async setDefaultEnabled(enabled: boolean): Promise<AutocompleteSettings> {
    await this.options.settings.setAutocompleteDefaultEnabled(enabled)
    if (this.#enabledOverride === undefined) this.#preferencesChanged('toggle')
    this.options.log.info(
      { event: 'autocomplete.default_enabled_changed', enabled },
      'Autocomplete default updated'
    )
    return this.settings()
  }
  async session(projectSessionId: string): Promise<AutocompleteSession> {
    // Register synchronously so revocation during asynchronous settings reads cannot resurrect work.
    if (!this.#sessions.has(projectSessionId)) this.#sessions.set(projectSessionId, {})
    const settings = await this.settings()
    return {
      ...settings,
      style: this.#styleOverride ?? settings.style,
      enabled: (this.#enabledOverride ?? settings.defaultEnabled) && settings.available,
      overrides: {
        enabled: this.#enabledOverride !== undefined,
        style: this.#styleOverride !== undefined
      }
    }
  }
  async toggle(projectSessionId: string, enabled: boolean): Promise<AutocompleteSession> {
    this.#enabledOverride = enabled
    this.#preferencesChanged('toggle')
    this.options.log.info(
      { event: 'autocomplete.toggled', projectSessionId, enabled },
      'Autocomplete temporary preference changed'
    )
    return this.session(projectSessionId)
  }
  async setSessionStyle(
    projectSessionId: string,
    style: AutocompleteStyle
  ): Promise<AutocompleteSession> {
    this.#styleOverride = style
    this.#preferencesChanged('style')
    this.options.log.info(
      { event: 'autocomplete.temporary_style_changed', projectSessionId, style },
      'Autocomplete temporary preference changed'
    )
    return this.session(projectSessionId)
  }
  async resetOverrides(projectSessionId: string): Promise<AutocompleteSession> {
    this.#enabledOverride = undefined
    this.#styleOverride = undefined
    this.#preferencesChanged('toggle')
    this.options.log.info(
      { event: 'autocomplete.overrides_reset', projectSessionId },
      'Autocomplete defaults restored'
    )
    return this.session(projectSessionId)
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
    if (state?.delivered?.requestId !== requestId) return
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
    if (!state) return result('unavailable')
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
      state.pending === pending &&
      this.#sessions.get(input.projectSessionId) === state &&
      version === this.#configurationVersion
    try {
      const selection = await this.options.settings.getAutocompleteSelection()
      const enabled =
        this.#enabledOverride ?? (await this.options.settings.getAutocompleteDefaultEnabled())
      const style = this.#styleOverride ?? (await this.options.settings.getAutocompleteStyle())
      const credential = selection === null ? null : await this.options.credential()
      if (!current()) return result('cancelled')
      if (!enabled || selection === null || credential === null) return result('unavailable')
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
