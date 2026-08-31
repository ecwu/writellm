import { XMLParser } from 'fast-xml-parser'

export function assertInTextCslStyle(xml: string): void {
  const document = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(
    xml
  ) as {
    style?: { '@_class'?: string }
  }
  if (document.style?.['@_class'] !== 'in-text') {
    throw new Error('Only in-text CSL styles are supported')
  }
}
