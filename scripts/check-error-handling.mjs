import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { matchingTokenIndex, SyntaxKind, tokenizeTypeScript } from './lib/ts-source.mjs'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const MARKER_LINE = /^\s*\/\/\s*error-handling:\s*allow\b(.*)$/iu
const OWNER_FIELD = /\bowner=[^\s]+/u
const CAUSE_FIELD = /\b(?:cause|reason)=[^\s]+/u

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultSourceRoot = resolve(scriptDirectory, '../src')

/**
 * Scan source text for catches that discard the original error without documenting the
 * ownership and recovery cause. A catch must either reference its error binding or carry an
 * `error-handling: allow` marker. The scanner is token-aware, so strings, comments, regex
 * literals, and template text do not create findings; template expressions remain executable.
 */
export function scanSourceText(source, filePath = 'source.ts') {
  const tokens = tokenizeTypeScript(source, { rescanRegex: true })
  const findings = []
  const report = (position, kind, message) =>
    addFinding(findings, findingFor(source, filePath, position, kind, message))

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind === SyntaxKind.CatchKeyword && tokens[index - 1]?.kind !== SyntaxKind.DotToken) {
      inspectCatchClause(tokens, index, report)
      continue
    }
    if (
      token.kind === SyntaxKind.DotToken &&
      tokens[index + 1]?.kind === SyntaxKind.CatchKeyword &&
      tokens[index + 2]?.kind === SyntaxKind.OpenParenToken
    ) {
      inspectPromiseCatch(tokens, index, report)
    }
  }

  return findings
}

function inspectCatchClause(tokens, catchIndex, report) {
  const catchToken = tokens[catchIndex]
  let bodyOpen = catchIndex + 1
  let binding
  if (tokens[bodyOpen]?.kind === SyntaxKind.OpenParenToken) {
    const close = matchingTokenIndex(
      tokens,
      bodyOpen,
      SyntaxKind.OpenParenToken,
      SyntaxKind.CloseParenToken
    )
    if (close === -1) return
    const first = tokens[bodyOpen + 1]
    // Destructured bindings deliberately read selected fields; only plain names are checked.
    if (first?.kind === SyntaxKind.Identifier) binding = first.text
    bodyOpen = close + 1
  }
  if (tokens[bodyOpen]?.kind !== SyntaxKind.OpenBraceToken) return
  const bodyClose = matchingTokenIndex(
    tokens,
    bodyOpen,
    SyntaxKind.OpenBraceToken,
    SyntaxKind.CloseBraceToken
  )
  if (bodyClose === -1) return
  if (bodyClose === bodyOpen + 1) {
    report(
      catchToken.start,
      'empty-catch',
      'empty catch blocks must preserve the original error or document their owner and cause'
    )
    return
  }
  if (binding === undefined) {
    if (tokens[catchIndex + 1]?.kind === SyntaxKind.OpenParenToken) return
    report(
      catchToken.start,
      'unbound-catch',
      'catch blocks without an error binding must document their owner and cause'
    )
    return
  }
  if (!referencesIdentifier(tokens, bodyOpen + 1, bodyClose, binding)) {
    report(
      catchToken.start,
      'unused-catch-binding',
      `catch blocks must use the original error \`${binding}\` or document their owner and cause`
    )
  }
}

function inspectPromiseCatch(tokens, dotIndex, report) {
  const callOpen = dotIndex + 2
  const callClose = matchingTokenIndex(
    tokens,
    callOpen,
    SyntaxKind.OpenParenToken,
    SyntaxKind.CloseParenToken
  )
  if (callClose === -1) return
  let callback = callOpen + 1
  if (tokens[callback]?.text === 'async') callback += 1
  let parameter
  let arrow
  if (tokens[callback]?.kind === SyntaxKind.Identifier) {
    parameter = tokens[callback].text
    arrow = callback + 1
  } else if (tokens[callback]?.kind === SyntaxKind.OpenParenToken) {
    const parametersClose = matchingTokenIndex(
      tokens,
      callback,
      SyntaxKind.OpenParenToken,
      SyntaxKind.CloseParenToken
    )
    if (parametersClose === -1) return
    if (parametersClose > callback + 1) {
      const first = tokens[callback + 1]
      if (first?.kind !== SyntaxKind.Identifier) return
      parameter = first.text
    }
    arrow = parametersClose + 1
    // Skip an optional return type annotation such as `(err): never =>`.
    while (
      arrow < callClose &&
      tokens[arrow]?.kind !== SyntaxKind.EqualsGreaterThanToken &&
      tokens[arrow]?.kind !== SyntaxKind.OpenBraceToken
    ) {
      arrow += 1
    }
  } else {
    // A function reference such as `.catch(report)` receives the rejection.
    return
  }
  if (tokens[arrow]?.kind !== SyntaxKind.EqualsGreaterThanToken) return
  if (parameter === undefined) {
    report(
      tokens[dotIndex].start,
      'swallowed-promise',
      'zero-argument Promise catches must preserve the rejection or document their owner and cause'
    )
    return
  }
  if (!referencesIdentifier(tokens, arrow + 1, callClose, parameter)) {
    report(
      tokens[dotIndex].start,
      'unused-rejection',
      `Promise catches must use the rejection \`${parameter}\` or document their owner and cause`
    )
  }
}

function referencesIdentifier(tokens, start, end, name) {
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]
    if (token.kind !== SyntaxKind.Identifier || token.text !== name) continue
    // `object.name` is a property access, not a use of the binding.
    if (tokens[index - 1]?.kind === SyntaxKind.DotToken) continue
    return true
  }
  return false
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
        ? `${message}; add // error-handling: allow owner=<owner> reason=<reason>`
        : `${message}; marker must include owner=<owner> and reason=<reason>`
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
