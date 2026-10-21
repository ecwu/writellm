import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const MARKER_LINE = /^\s*\/\/\s*error-handling:\s*allow\b(.*)$/iu
const OWNER_FIELD = /\bowner=[^\s]+/u
const CAUSE_FIELD = /\b(?:cause|reason)=[^\s]+/u
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

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultSourceRoot = resolve(scriptDirectory, '../src')

/**
 * Scan source text for catches that intentionally discard a rejection without documenting the
 * ownership and recovery cause. The scanner is token-aware, so strings, comments, regex literals,
 * and template text do not create findings; template expressions remain executable tokens.
 */
export function scanSourceText(source, filePath = 'source.ts') {
  const tokens = tokenize(source)
  const findings = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind === SyntaxKind.CatchKeyword) {
      const bodyOpen = catchBodyOpen(tokens, index)
      if (bodyOpen !== -1 && tokens[bodyOpen + 1]?.kind === SyntaxKind.CloseBraceToken) {
        addFinding(
          findings,
          findingFor(
            source,
            filePath,
            token.start,
            'empty-catch',
            'empty catch blocks must preserve the original error or document their owner and cause'
          )
        )
      }
    }

    if (
      token.kind !== SyntaxKind.DotToken ||
      tokens[index + 1]?.kind !== SyntaxKind.CatchKeyword ||
      tokens[index + 2]?.kind !== SyntaxKind.OpenParenToken
    ) {
      continue
    }
    let callback = index + 3
    if (tokens[callback]?.text === 'async') callback += 1
    if (
      tokens[callback]?.kind !== SyntaxKind.OpenParenToken ||
      tokens[callback + 1]?.kind !== SyntaxKind.CloseParenToken ||
      tokens[callback + 2]?.kind !== SyntaxKind.EqualsGreaterThanToken
    ) {
      continue
    }
    addFinding(
      findings,
      findingFor(
        source,
        filePath,
        token.start,
        'swallowed-promise',
        'zero-argument Promise catches must preserve the rejection or document their owner and cause'
      )
    )
  }

  return findings
}

/** Return every unapproved swallowed-error finding beneath a source tree. */
export async function scanErrorHandling(sourceRoot = defaultSourceRoot) {
  const absoluteRoot = resolve(sourceRoot)
  const files = await collectSourceFiles(absoluteRoot)
  const findings = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    findings.push(...scanSourceText(source, relative(absoluteRoot, file)))
  }
  return findings
}

export function formatFindings(findings) {
  return findings
    .map((finding) => `${finding.filePath}:${finding.line}:${finding.column} ${finding.message}`)
    .join('\n')
}

function addFinding(findings, finding) {
  if (finding !== undefined) findings.push(finding)
}

function tokenize(source) {
  const scanner = createScanner(true, LanguageVariant.Standard, source, 0)
  const tokens = []
  let kind = scanner.scan()
  while (kind !== SyntaxKind.EndOfFile) {
    if (
      kind === SyntaxKind.SlashToken &&
      likelyRegexStart(tokens) &&
      !isJsxClosingTagStart(source, scanner.getTokenStart())
    ) {
      kind = scanner.reScanSlashToken()
    }
    const start = scanner.getTokenStart()
    const end = scanner.getTokenEnd()
    if (end <= start) {
      // Keep malformed/raw tokens from stalling the CI scan forever.
      scanner.resetTokenState(start + 1)
      kind = scanner.scan()
      continue
    }
    tokens.push({
      kind,
      start,
      end,
      text: scanner.getTokenText()
    })
    kind = scanner.scan()
  }
  return tokens
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

function catchBodyOpen(tokens, catchIndex) {
  let index = catchIndex + 1
  if (tokens[index]?.kind === SyntaxKind.OpenParenToken) {
    const close = matchingToken(
      tokens,
      index,
      SyntaxKind.OpenParenToken,
      SyntaxKind.CloseParenToken
    )
    if (close === -1) return -1
    index = close + 1
  }
  return tokens[index]?.kind === SyntaxKind.OpenBraceToken ? index : -1
}

function matchingToken(tokens, openIndex, openKind, closeKind) {
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

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === 'generated' ||
        entry.name === 'node_modules' ||
        entry.name === '__tests__'
      ) {
        continue
      }
      files.push(...(await collectSourceFiles(path)))
      continue
    }
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) continue
    if (isTestFile(entry.name) || path.split(sep).includes('generated')) continue
    files.push(path)
  }
  return files.sort()
}

function isTestFile(fileName) {
  return /(?:\.test|\.spec)\.[^.]+$/u.test(fileName)
}

function findingFor(source, filePath, position, kind, message) {
  const { line, column } = lineAndColumn(source, position)
  const marker = precedingMarker(source, position)
  if (marker !== null && OWNER_FIELD.test(marker) && CAUSE_FIELD.test(marker)) return undefined
  return {
    filePath,
    line,
    column,
    kind,
    message:
      marker === null
        ? `${message}; add // error-handling: allow owner=<owner> cause=<cause>`
        : `${message}; marker must include owner=<owner> and cause=<cause>`
  }
}

function precedingMarker(source, position) {
  const currentLineStart = source.lastIndexOf('\n', position - 1) + 1
  if (currentLineStart === 0) return null
  const previousLineStart = source.lastIndexOf('\n', currentLineStart - 2) + 1
  const line = source.slice(previousLineStart, currentLineStart).replace(/\r?\n$/u, '')
  return line.match(MARKER_LINE)?.[1] ?? null
}

function lineAndColumn(source, position) {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < position; index += 1) {
    if (source[index] === '\n') {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: position - lineStart + 1 }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const sourceRoot = process.argv[2] === undefined ? defaultSourceRoot : resolve(process.argv[2])
  const findings = await scanErrorHandling(sourceRoot)
  if (findings.length > 0) {
    process.stderr.write(`${formatFindings(findings)}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`Error-handling check passed (${sourceRoot})\n`)
  }
}
