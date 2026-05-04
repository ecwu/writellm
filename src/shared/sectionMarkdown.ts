export function defaultSectionMarkdown(): string {
  return '';
}

export function sectionMarkdownForStorage(markdown: string): string {
  return stripMarkdownHeadings(markdown);
}

export function sectionMarkdownForExport(title: string, markdown: string, depth: number): string {
  const level = Math.max(1, Math.min(depth + 1, 6));
  const heading = `${'#'.repeat(level)} ${title.replace(/\s+/g, ' ').trim() || 'Untitled section'}`;
  const body = stripMarkdownHeadings(markdown).trim();
  return body ? `${heading}\n\n${body}` : heading;
}

export function stripMarkdownHeadings(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const kept: string[] = [];
  let inFence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (inFence === marker) {
        inFence = null;
      } else if (!inFence) {
        inFence = marker;
      }
      kept.push(line);
      continue;
    }

    if (!inFence && isAtxHeading(line)) {
      continue;
    }

    if (!inFence && index + 1 < lines.length && line.trim() && isSetextHeadingUnderline(lines[index + 1])) {
      index += 1;
      continue;
    }

    kept.push(line);
  }

  while (kept.length > 0 && kept[0].trim() === '') {
    kept.shift();
  }

  return kept.join('\n');
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s+|$)/.test(line);
}

function isSetextHeadingUnderline(line: string): boolean {
  return /^ {0,3}(?:=+|-+)\s*$/.test(line);
}
