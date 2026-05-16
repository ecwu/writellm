type CitationHighlightProps = {
  text: string;
};

const citationPattern = /(\[[A-Za-z0-9_.-]+\])/g;
const exactCitationPattern = /^\[[A-Za-z0-9_.-]+\]$/;

export function CitationHighlight({ text }: CitationHighlightProps) {
  return (
    <p className="citation-highlight-text">
      {text.split(citationPattern).map((part, index) =>
        exactCitationPattern.test(part) ? (
          <span key={`${part}:${index}`} className="citation-highlight">
            {part}
          </span>
        ) : (
          <span key={`${part}:${index}`}>{part}</span>
        )
      )}
    </p>
  );
}
