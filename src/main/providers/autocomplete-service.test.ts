import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  autocompleteRequestSchema,
  type AutocompleteSelection,
  type AutocompleteStyle,
  type AutocompleteWorkerResult
} from '../../shared/contracts/autocomplete'
import { AutocompleteService } from './autocomplete-service'
import { withLogContext } from '../observability/log-context'
const input = autocompleteRequestSchema.parse({
  requestId: '00000000-0000-4000-8000-000000000001',
  projectSessionId: '00000000-0000-4000-8000-000000000002',
  sectionId: '00000000-0000-4000-8000-000000000003',
  blockId: 'block',
  generation: 1,
  prefix: 'Private prefix',
  suffix: ' suffix',
  atBlockEnd: false
})
const response: AutocompleteWorkerResult = {
  type: 'autocomplete-result',
  requestId: input.requestId,
  projectSessionId: input.projectSessionId,
  text: ' suggestion'
}
function harness() {
  let defaultEnabled = false
  let style: AutocompleteStyle = 'word'
  let selection: AutocompleteSelection | null = {
    providerPresetId: 'builtin:deepseek',
    modelId: 'deepseek-v4-pro'
  }
  const options = {
    settings: {
      getAutocompleteDefaultEnabled: vi.fn(async () => defaultEnabled),
      setAutocompleteDefaultEnabled: vi.fn(async (value: boolean) => {
        defaultEnabled = value
      }),
      getAutocompleteStyle: vi.fn(async () => style),
      setAutocompleteStyle: vi.fn(async (value: AutocompleteStyle) => {
        style = value
      }),
      getAutocompleteSelection: vi.fn(async () => selection),
      setAutocompleteSelection: vi.fn(async (value: AutocompleteSelection | null) => {
        selection = value
      })
    },
    credential: vi.fn(async (): Promise<string | null> => 'private-key'),
    gateway: { complete: vi.fn(async () => response) },
    assertSection: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    changed: vi.fn(),
    timeoutMs: 100
  }
  return { options, service: new AutocompleteService(options) }
}
afterEach(() => vi.useRealTimers())
describe('AutocompleteService', () => {
  it('starts disabled, remembers temporary preferences across project sessions and has no inherited model', async () => {
    const { service, options } = harness()
    expect(await service.session(input.projectSessionId)).toMatchObject({ enabled: false })
    await service.complete(input)
    expect(options.gateway.complete).not.toHaveBeenCalled()
    await service.toggle(input.projectSessionId, true)
    expect(await service.session(input.projectSessionId)).toMatchObject({ enabled: true })
    service.revokeSession(input.projectSessionId)
    expect(await service.session(input.projectSessionId)).toMatchObject({ enabled: true })
    await service.select(null)
    expect(await service.toggle(input.projectSessionId, true)).toMatchObject({
      enabled: false,
      available: false,
      selection: null
    })
  })
  it('changes global style without enabling sessions or changing the model', async () => {
    const { service, options } = harness()
    const previous = await service.settings()
    await service.select(previous.selection)
    expect(options.changed).toHaveBeenLastCalledWith({ reason: 'model' })
    service.configurationChanged()
    expect(options.changed).toHaveBeenLastCalledWith({ reason: 'provider' })
    expect(previous.style).toBe('word')
    expect(await service.setStyle('paragraph')).toMatchObject({
      style: 'paragraph',
      selection: previous.selection
    })
    expect(options.changed).toHaveBeenLastCalledWith({ reason: 'style' })
    expect(await service.session(input.projectSessionId)).toMatchObject({
      enabled: false,
      style: 'paragraph'
    })
    await service.toggle(input.projectSessionId, true)
    await service.complete(input)
    expect(options.gateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'paragraph' }),
      expect.any(AbortSignal)
    )
    service.revokeSession(input.projectSessionId)
    expect(await service.session(input.projectSessionId)).toMatchObject({
      enabled: true,
      style: 'paragraph'
    })
  })
  it('keeps independent temporary overrides across projects and restores saved defaults on restart', async () => {
    const { service, options } = harness()
    await service.setDefaultEnabled(true)
    await service.setStyle('sentence')
    expect(await service.session(input.projectSessionId)).toMatchObject({
      enabled: true,
      style: 'sentence',
      overrides: { enabled: false, style: false }
    })
    await service.toggle(input.projectSessionId, false)
    await service.setStyle('paragraph')
    expect(await service.session(input.projectSessionId)).toMatchObject({
      enabled: false,
      style: 'paragraph'
    })
    await service.setSessionStyle(input.projectSessionId, 'word')
    await service.setDefaultEnabled(false)
    await service.setDefaultEnabled(true)
    await service.setStyle('sentence')
    expect(await service.settings()).toMatchObject({ defaultEnabled: true, style: 'sentence' })
    service.revokeSession(input.projectSessionId)
    const second = '00000000-0000-4000-8000-000000000004'
    expect(await service.session(second)).toMatchObject({
      enabled: false,
      style: 'word',
      overrides: { enabled: true, style: true }
    })
    const restarted = new AutocompleteService(options)
    expect(await restarted.session(second)).toMatchObject({
      enabled: true,
      style: 'sentence',
      overrides: { enabled: false, style: false }
    })
    expect(await service.resetOverrides(second)).toMatchObject({
      enabled: true,
      style: 'sentence',
      overrides: { enabled: false, style: false }
    })
  })
  it('uses the temporary length without persisting it and retains enable intent while unavailable', async () => {
    const { service, options } = harness()
    options.credential.mockResolvedValue(null)
    await service.setDefaultEnabled(true)
    expect(await service.session(input.projectSessionId)).toMatchObject({
      enabled: false,
      defaultEnabled: true
    })
    await service.setSessionStyle(input.projectSessionId, 'paragraph')
    options.credential.mockResolvedValue('private-key')
    service.configurationChanged()
    expect(await service.session(input.projectSessionId)).toMatchObject({ enabled: true })
    await service.complete(input)
    expect(options.gateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({ style: 'paragraph' }),
      expect.any(AbortSignal)
    )
    expect(options.settings.setAutocompleteStyle).not.toHaveBeenCalled()
    expect(await service.settings()).toMatchObject({ style: 'word' })
  })
  it('does not recreate a revoked session after a pending settings read', async () => {
    const { service, options } = harness()
    const pending = Promise.withResolvers<boolean>()
    options.settings.getAutocompleteDefaultEnabled.mockReturnValueOnce(pending.promise)
    const reading = service.session(input.projectSessionId)
    service.revokeSession(input.projectSessionId)
    pending.resolve(true)
    await reading
    expect(await service.complete(input)).toMatchObject({ status: 'unavailable' })
    expect(options.gateway.complete).not.toHaveBeenCalled()
  })
  it('resolves each request, correlates the worker and never logs private content', async () => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    expect(
      await withLogContext({ operationId: 'operation', jobId: 'job' }, () =>
        service.complete(input)
      )
    ).toMatchObject({ status: 'suggestion', text: ' suggestion' })
    expect(options.gateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: 'private-key',
        context: expect.objectContaining({
          operationId: 'operation',
          jobId: 'job',
          requestId: input.requestId
        })
      }),
      expect.any(AbortSignal)
    )
    service.accepted(input.projectSessionId, input.requestId)
    expect(options.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'autocomplete.accepted' }),
      expect.any(String)
    )
    const logged = JSON.stringify(options.log.info.mock.calls)
    expect(logged).not.toContain('Private prefix')
    expect(logged).not.toContain('private-key')
  })
  it.each([
    'configuration',
    'style',
    'temporary-style',
    'reset',
    'close',
    'disable',
    'cancel',
    'newer'
  ] as const)('discards a response after %s', async (action) => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    const pending = Promise.withResolvers<AutocompleteWorkerResult>()
    options.gateway.complete.mockReturnValueOnce(pending.promise)
    const first = service.complete(input)
    await vi.waitFor(() => expect(options.gateway.complete).toHaveBeenCalledTimes(1))
    if (action === 'temporary-style')
      await service.setSessionStyle(input.projectSessionId, 'paragraph')
    if (action === 'reset') await service.resetOverrides(input.projectSessionId)
    if (action === 'style') await service.setStyle('sentence')
    if (action === 'configuration') service.configurationChanged()
    if (action === 'close') service.revokeSession(input.projectSessionId)
    if (action === 'disable') await service.toggle(input.projectSessionId, false)
    if (action === 'cancel') service.cancel(input.projectSessionId, input.requestId)
    if (action === 'newer')
      await service.complete({ ...input, requestId: '00000000-0000-4000-8000-000000000004' })
    pending.resolve(response)
    expect(await first).toMatchObject({ status: 'cancelled', text: '' })
  })
  it.each([401, 403])('pauses after HTTP %s until configuration changes', async (httpStatus) => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    options.gateway.complete.mockResolvedValueOnce({
      ...response,
      text: '',
      error: { name: 'Error', message: 'Rejected', httpStatus }
    })
    expect(await service.complete(input)).toMatchObject({ status: 'paused' })
    expect(await service.complete(input)).toMatchObject({ status: 'paused' })
    expect(options.gateway.complete).toHaveBeenCalledTimes(1)
    await service.setStyle('paragraph')
    await service.setDefaultEnabled(true)
    await service.setSessionStyle(input.projectSessionId, 'sentence')
    await service.resetOverrides(input.projectSessionId)
    expect(await service.complete(input)).toMatchObject({ status: 'paused' })
    expect(options.gateway.complete).toHaveBeenCalledTimes(1)
    service.configurationChanged()
    expect(await service.complete(input)).toMatchObject({ status: 'suggestion' })
  })
  it('honors longer Retry-After and never retries without another edit request', async () => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    const retryAt = Date.now() + 90_000
    options.gateway.complete.mockResolvedValueOnce({
      ...response,
      text: '',
      error: { name: 'Error', message: 'Rate limited', httpStatus: 429, retryAt }
    })
    expect(await service.complete(input)).toMatchObject({ status: 'cooldown', retryAt })
    await service.setStyle('sentence')
    expect(await service.complete(input)).toMatchObject({ status: 'cooldown', retryAt })
    expect(options.gateway.complete).toHaveBeenCalledTimes(1)
  })
  it('aborts on its deadline and does not restart', async () => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    options.gateway.complete.mockImplementation(
      (_request?: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('Cancelled')))
        )
    )
    expect(await service.complete(input)).toMatchObject({ status: 'failed' })
    expect(options.gateway.complete).toHaveBeenCalledTimes(1)
  })
  it('rechecks missing credentials and section authority before dispatch', async () => {
    const { service, options } = harness()
    await service.toggle(input.projectSessionId, true)
    options.credential.mockResolvedValue(null)
    expect(await service.complete(input)).toMatchObject({ status: 'unavailable' })
    expect(options.gateway.complete).not.toHaveBeenCalled()
    options.assertSection.mockImplementation(() => {
      throw new Error('Revoked section')
    })
    await expect(service.complete(input)).rejects.toThrow('Revoked section')
  })
})
