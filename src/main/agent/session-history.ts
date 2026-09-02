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

/** Fit a provider summary to its actual message envelope, preserving its prefix. */
export function fitCheckpointSummary(
  summary: string,
  fits: (candidate: string) => boolean
): string {
  if (fits(summary)) return summary
  const characters = Array.from(summary)
  const marker = '\n[Summary shortened to fit the model input window.]'
  let low = 0
  let high = characters.length
  let best = ''
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const candidate = characters.slice(0, count).join('') + marker
    if (fits(candidate)) {
      best = candidate
      low = count + 1
    } else {
      high = count - 1
    }
  }
  return best
}
