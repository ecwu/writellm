import type { AgentHistoryMessage } from '../../shared/contracts/agent'
import { estimateAgentTokens } from '../../shared/agent-context-budget'

export function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value
  let low = 0
  let high = Math.min(value.length, maximumBytes)
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, midpoint)) <= maximumBytes) low = midpoint
    else high = midpoint - 1
  }
  if (
    low > 0 &&
    low < value.length &&
    value.charCodeAt(low - 1) >= 0xd800 &&
    value.charCodeAt(low - 1) <= 0xdbff &&
    value.charCodeAt(low) >= 0xdc00 &&
    value.charCodeAt(low) <= 0xdfff
  ) {
    low -= 1
  }
  return value.slice(0, low)
}

export function boundHistoryByCompleteTurns(
  history: readonly AgentHistoryMessage[],
  tokenBudget: number
): AgentHistoryMessage[] {
  const checkpoint = isCheckpointHistoryMessage(history[0]) ? history[0] : undefined
  const tail = checkpoint === undefined ? history : history.slice(1)
  const turns: AgentHistoryMessage[][] = []
  for (const message of tail) {
    if (message.role === 'user' || turns.length === 0) turns.push([])
    turns.at(-1)?.push(message)
  }
  const selected: AgentHistoryMessage[][] = []
  const checkpointTokens = checkpoint === undefined ? 0 : estimateAgentTokens(checkpoint)
  const checkpointBytes =
    checkpoint === undefined ? 0 : Buffer.byteLength(JSON.stringify(checkpoint))
  let keepCheckpoint =
    checkpoint !== undefined && checkpointTokens <= tokenBudget && checkpointBytes + 3 <= 2_097_152
  const needsOmissionMarker =
    estimateAgentTokens(history) > tokenBudget ||
    Buffer.byteLength(JSON.stringify(history)) > 2_097_152 ||
    history.length > 200
  const omissionMarker: AgentHistoryMessage | undefined = needsOmissionMarker
    ? {
        role: 'user',
        content:
          '<WRITELLM_CONTEXT_OMISSION instructionSemantics="false" authority="none">Older complete turns were omitted by deterministic context fallback. Raw Agent events remain authoritative.</WRITELLM_CONTEXT_OMISSION>',
        timestamp: 0
      }
    : undefined
  const markerTokens = omissionMarker === undefined ? 0 : estimateAgentTokens(omissionMarker)
  const markerBytes =
    omissionMarker === undefined ? 0 : Buffer.byteLength(JSON.stringify(omissionMarker))
  if (keepCheckpoint && checkpointTokens + markerTokens > tokenBudget) keepCheckpoint = false
  let tokens = keepCheckpoint ? checkpointTokens : 0
  let bytes = keepCheckpoint ? checkpointBytes + 3 : 2
  let messages = keepCheckpoint ? 1 : 0
  if (omissionMarker !== undefined && markerTokens <= tokenBudget - tokens) {
    tokens += markerTokens
    bytes += markerBytes + 1
    messages += 1
  }
  for (const turn of turns.reverse()) {
    const turnTokens = estimateAgentTokens(turn)
    const turnBytes = Buffer.byteLength(JSON.stringify(turn)) + 1
    if (
      tokens + turnTokens > tokenBudget ||
      bytes + turnBytes > 2_097_152 ||
      messages + turn.length > 200
    ) {
      break
    }
    selected.push(turn)
    tokens += turnTokens
    bytes += turnBytes
    messages += turn.length
  }
  return [
    ...(keepCheckpoint && checkpoint !== undefined ? [checkpoint] : []),
    ...(omissionMarker !== undefined && messages > selected.flat().length + (keepCheckpoint ? 1 : 0)
      ? [omissionMarker]
      : []),
    ...selected.reverse().flat()
  ]
}

export function historyProjectionChanged(
  original: readonly AgentHistoryMessage[],
  projected: readonly AgentHistoryMessage[]
): boolean {
  return (
    original.length !== projected.length ||
    projected.some((message, index) => message !== original[index])
  )
}

export function isCheckpointHistoryMessage(
  message: AgentHistoryMessage | undefined
): message is Extract<AgentHistoryMessage, { role: 'user' }> {
  return message?.role === 'user' && message.content.startsWith('<WRITELLM_CONTEXT_CHECKPOINT ')
}

export function boundCheckpointSummary(summary: string, tokenBudget: number): string {
  if (estimateAgentTokens(summary) <= tokenBudget) return summary
  const characters = Array.from(summary)
  let low = 1
  let high = characters.length
  let best = 1
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const firstCount = Math.max(1, Math.floor(count * 0.65))
    const candidate = `${characters.slice(0, firstCount).join('')}\n[checkpoint shortened deterministically]\n${characters.slice(-(count - firstCount)).join('')}`
    if (estimateAgentTokens(candidate) <= tokenBudget) {
      best = count
      low = count + 1
    } else {
      high = count - 1
    }
  }
  const firstCount = Math.max(1, Math.floor(best * 0.65))
  return `${characters.slice(0, firstCount).join('')}\n[checkpoint shortened deterministically]\n${characters.slice(-(best - firstCount)).join('')}`
}
