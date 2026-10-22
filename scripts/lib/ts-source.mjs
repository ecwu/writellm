// TypeScript 7 exposes its scanner only through `typescript/unstable/ast`. The package version is
// pinned exactly in package.json so this import cannot change shape on a dependency refresh.
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'

export { SyntaxKind }

const REGEX_PREFIXES = new Set([
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '=',
  '==',
  '===',
  '!=',
  '!==',
  '!',
  '&',
  '&&',
  '|',
  '||',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>',
  '=>',
  '?',
  '??'
])
const REGEX_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'delete',
  'void',
  'typeof',
  'instanceof',
  'in',
  'of',
  'yield',
  'await'
])

/**
 * Tokenize TypeScript source without comments or trivia.
 *
 * `rescanRegex` re-reads a slash that starts a regular expression so regex text never produces
 * tokens. `failOnUnterminated` rejects unterminated strings and templates instead of skipping.
 */
export function tokenizeTypeScript(source, options = {}) {
  const scanner = createScanner(true, LanguageVariant.Standard, source, 0)
  const tokens = []
  // Track braces so the `}` that closes a template substitution is re-read as template text.
  const nesting = []
  let kind = scanner.scan()
  while (kind !== SyntaxKind.EndOfFile) {
    if (kind === SyntaxKind.CloseBraceToken && nesting.at(-1) === 'template') {
      kind = scanner.reScanTemplateToken(false)
    }
    if (kind === SyntaxKind.TemplateHead || kind === SyntaxKind.OpenBraceToken) {
      nesting.push(kind === SyntaxKind.TemplateHead ? 'template' : 'brace')
    } else if (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.TemplateTail) {
      nesting.pop()
    }
    if (
      options.rescanRegex === true &&
      kind === SyntaxKind.SlashToken &&
      likelyRegexStart(tokens) &&
      !isJsxClosingTagStart(source, scanner.getTokenStart())
    ) {
      kind = scanner.reScanSlashToken()
    }
    if (options.failOnUnterminated === true && scanner.isUnterminated()) {
      throw new Error('Unterminated token in TypeScript source')
    }
    const start = scanner.getTokenStart()
    const end = scanner.getTokenEnd()
    if (end <= start) {
      // Keep malformed or raw tokens from stalling a scan.
      scanner.resetTokenState(start + 1)
      kind = scanner.scan()
      continue
    }
    tokens.push({
      kind,
      start,
      end,
      text: scanner.getTokenText(),
      hasPrecedingLineBreak: scanner.hasPrecedingLineBreak()
    })
    kind = scanner.scan()
  }
  return tokens
}

/** Return the index of the token that closes the bracket opened at `openIndex`, or -1. */
export function matchingTokenIndex(tokens, openIndex, openKind, closeKind) {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].kind === openKind) depth += 1
    else if (tokens[index].kind === closeKind) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function likelyRegexStart(tokens) {
  const previous = tokens.at(-1)
  return (
    previous === undefined || REGEX_PREFIXES.has(previous.text) || REGEX_KEYWORDS.has(previous.text)
  )
}

function isJsxClosingTagStart(source, slashStart) {
  if (source[slashStart - 1] !== '<') return false
  // A closing JSX tag starts with `</`, while a less-than regex can also do so. Require a
  // tag-shaped prefix and a JSX boundary after `>` before leaving the slash unrescanned.
  const closingTag = source.slice(slashStart).match(/^\/(?:[A-Za-z_$][\w$.-]*\s*|)>/u)
  if (closingTag === null) return false
  const nextCharacter = source[slashStart + closingTag[0].length]
  return nextCharacter === undefined || /[\s<{()[\],;?:]/u.test(nextCharacter)
}
