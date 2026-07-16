import type {
  ProviderProbeRequest,
  ProviderProbeResponse
} from '../shared/contracts/provider-probe'

export async function runProviderProbeRequest(
  request: ProviderProbeRequest,
  fetchImplementation: typeof fetch = fetch
): Promise<ProviderProbeResponse> {
  try {
    const path =
      request.config.role === 'mineru' ? 'api/v4/extract/task/__writellm_probe__' : 'models'
    const response = await fetchImplementation(new URL(path, `${request.config.baseUrl}/`), {
      method: 'GET',
      headers: { Authorization: `Bearer ${request.credential}`, Accept: 'application/json' },
      redirect: 'error'
    })
    if (request.config.role !== 'mineru') {
      return { type: 'result', requestId: request.requestId, status: response.status }
    }

    const body = (await response.text()).slice(0, 4_096)
    try {
      const value = JSON.parse(body) as { code?: unknown }
      return {
        type: 'result',
        requestId: request.requestId,
        status: response.status,
        providerCode: String(value.code ?? '')
      }
    } catch {
      return { type: 'result', requestId: request.requestId, status: response.status }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Provider probe failed', { cause: err })
    return {
      type: 'error',
      requestId: request.requestId,
      error: {
        name: error.name.slice(0, 200),
        message: error.message.slice(0, 4_096),
        ...(error.stack === undefined ? {} : { stack: error.stack.slice(0, 32_768) })
      }
    }
  }
}
