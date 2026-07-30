export function orderEnabledAgentProvidersFirst<T extends { enabled: boolean }>(
  presets: readonly T[]
): T[] {
  return [...presets].sort((left, right) => Number(right.enabled) - Number(left.enabled))
}
