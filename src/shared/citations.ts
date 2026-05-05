export type CitationGroupMatch = {
  raw: string;
  from: number;
  to: number;
  refs: string[];
};

const citationRefPattern = /[a-f0-9]{7}\.c\d+/gi;
const citationBracketPattern = /\[\s*[a-f0-9]{7}\.c\d+(?:\s*,\s*[a-f0-9]{7}\.c\d+)*\s*\]/gi;

export function citationRefsFromText(text: string): string[] {
  const refs = new Set<string>();
  for (const group of citationGroupsFromText(text)) {
    group.refs.forEach((ref) => refs.add(ref));
  }
  return [...refs];
}

export function citationGroupsFromText(text: string): CitationGroupMatch[] {
  citationBracketPattern.lastIndex = 0;
  const bracketMatches: CitationGroupMatch[] = [];
  for (const match of text.matchAll(citationBracketPattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (isMarkdownLinkOrImageBracket(text, match.index, match[0].length)) {
      continue;
    }
    bracketMatches.push({
      raw: match[0],
      from: match.index,
      to: match.index + match[0].length,
      refs: refsFromCitationText(match[0])
    });
  }

  const groups: CitationGroupMatch[] = [];
  for (const match of bracketMatches) {
    const previous = groups.at(-1);
    if (previous && /^\s*$/.test(text.slice(previous.to, match.from))) {
      appendRefs(previous.refs, match.refs);
      previous.raw = text.slice(previous.from, match.to);
      previous.to = match.to;
      continue;
    }
    groups.push({ ...match });
  }
  return groups;
}

export function refsFromCitationText(text: string): string[] {
  citationRefPattern.lastIndex = 0;
  const refs: string[] = [];
  for (const match of text.matchAll(citationRefPattern)) {
    appendRefs(refs, [match[0].toLowerCase()]);
  }
  return refs;
}

function isMarkdownLinkOrImageBracket(text: string, from: number, length: number): boolean {
  return text[from - 1] === '!' || text[from + length] === '(';
}

function appendRefs(target: string[], refs: string[]): void {
  const existing = new Set(target);
  refs.forEach((ref) => {
    const normalized = ref.toLowerCase();
    if (!existing.has(normalized)) {
      target.push(normalized);
      existing.add(normalized);
    }
  });
}
