const UNSAFE_MATH_COMMAND =
  /\\(?:begin|end|input|include|includegraphics|write|openout|read|usepackage|documentclass|newcommand|renewcommand|providecommand|def|edef|gdef|xdef|catcode|special|immediate|csname|href|url|htmlclass|htmlid|htmlstyle|htmldata)\b/iu

const EXTREME_DIMENSION =
  /(?:^|[^\d.])(\d{4,}(?:\.\d+)?)\s*(?:em|ex|mu|pt|pc|in|cm|mm|bp|dd|cc|sp)\b/giu

export function isMathSourceStructurallySafe(source: string): boolean {
  if (source.includes('\0') || UNSAFE_MATH_COMMAND.test(source)) return false
  EXTREME_DIMENSION.lastIndex = 0
  return !EXTREME_DIMENSION.test(source)
}
