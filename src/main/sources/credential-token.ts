export function normalizeBearerToken(credential: string): string {
  const trimmed = credential.trim();
  const assignment = /^(?:token|api[_ -]?key)\s*=\s*(["'])(.*?)\1\s*;?$/i.exec(trimmed);
  return (assignment?.[2] ?? trimmed)
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '');
}
