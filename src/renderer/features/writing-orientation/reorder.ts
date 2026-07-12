export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return [...items];
  const next = [...items], [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
