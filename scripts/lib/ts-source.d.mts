export { SyntaxKind } from 'typescript/unstable/ast'
import type { SyntaxKind } from 'typescript/unstable/ast'

export interface SourceToken {
  kind: SyntaxKind
  text: string
  start: number
  end: number
  hasPrecedingLineBreak: boolean
}

export interface TokenizeOptions {
  rescanRegex?: boolean
  failOnUnterminated?: boolean
}

export declare function tokenizeTypeScript(source: string, options?: TokenizeOptions): SourceToken[]

export declare function matchingTokenIndex(
  tokens: readonly SourceToken[],
  openIndex: number,
  openKind: SyntaxKind,
  closeKind: SyntaxKind
): number
