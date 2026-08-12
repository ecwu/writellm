export type PromptInstructionSemantics = 'true' | 'false'

export function formatPromptBlock(input: {
  tag: string
  content: string
  instructionSemantics: PromptInstructionSemantics
  attributes?: Readonly<Record<string, string>>
}): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(input.tag)) {
    throw new Error('Prompt block tag is invalid')
  }
  const attributes = Object.entries(input.attributes ?? {})
    .map(([name, value]) => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(name)) {
        throw new Error('Prompt block attribute name is invalid')
      }
      return `${name}="${escapePromptAttribute(value)}"`
    })
    .join(' ')
  const openingAttributes = [`instructionSemantics="${input.instructionSemantics}"`, attributes]
    .filter((value) => value.length > 0)
    .join(' ')
  return `<${input.tag} ${openingAttributes}>\n${escapePromptText(input.content)}\n</${input.tag}>`
}

export function escapePromptText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapePromptAttribute(value: string): string {
  return escapePromptText(value).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
