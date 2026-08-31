import { plugins } from '@citation-js/core'
import '@citation-js/plugin-csl'
import {
  citationFormatterRequestSchema,
  citationFormatterResponseSchema,
  type CitationFormatterRequest,
  type CitationFormatterResult
} from '../shared/contracts/citation-formatting'
import { assertInTextCslStyle } from '../shared/csl-style'

const IEEE_STYLE_ID = 'writellm-ieee'
const IEEE_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>WriteLLM IEEE</title>
    <id>https://writellm.local/styles/ieee</id>
    <updated>2026-08-31T00:00:00+00:00</updated>
  </info>
  <macro name="author">
    <names variable="author"><name initialize-with=". " and="text"/><substitute><text variable="title"/></substitute></names>
  </macro>
  <citation collapse="citation-number">
    <sort><key variable="citation-number"/></sort>
    <layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout>
  </citation>
  <bibliography second-field-align="flush" entry-spacing="0">
    <layout suffix=".">
      <text variable="citation-number" suffix=". "/>
      <group delimiter=", ">
        <text macro="author"/>
        <text variable="title" quotes="true"/>
        <text variable="container-title" font-style="italic"/>
        <date variable="issued"><date-part name="year"/></date>
      </group>
    </layout>
  </bibliography>
</style>`

interface CslEngine {
  rebuildProcessorState(citations: unknown[], format: string, uncited: unknown[]): unknown[][]
  makeBibliography(): [{ entry_ids: string[][]; bibliography_errors: unknown[] }, string[]]
}

interface CslConfig {
  engine(data: unknown[], style: string, locale: string, format: string): CslEngine
  styles: { add(name: string, xml: string): void; has(name: string): boolean }
}

export function formatCitationSnapshot(raw: CitationFormatterRequest): CitationFormatterResult {
  const request = citationFormatterRequestSchema.parse(raw)
  const config = plugins.config.get('@csl') as CslConfig
  const styleId = registerStyle(config, request.style)
  const engine = config.engine(request.items, styleId, request.locale, 'text')
  const citations = request.clusters.map((cluster, index) => ({
    citationID: cluster.clusterId,
    citationItems: cluster.items.map((item) => ({
      id: item.citationKey,
      ...(item.locator === undefined
        ? {}
        : {
            label: 'page',
            locator:
              item.locator.startPageIndex === item.locator.endPageIndex
                ? String(item.locator.startPageIndex + 1)
                : `${item.locator.startPageIndex + 1}-${item.locator.endPageIndex + 1}`
          })
    })),
    properties: { noteIndex: index + 1 }
  }))
  const rendered = engine.rebuildProcessorState(citations, 'text', [])
  const [parameters, entries] = engine.makeBibliography()
  if (parameters.bibliography_errors.length > 0) {
    throw new Error('CSL processor reported bibliography errors')
  }
  return citationFormatterResponseSchema.parse({
    type: 'citation-format-result',
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    snapshotHash: request.snapshotHash,
    citations: rendered.map((entry) => ({
      clusterId: String(entry[0]),
      formatted: String(entry[2] ?? '')
    })),
    bibliography: entries.map((formatted, index) => ({
      citationKey: parameters.entry_ids[index]?.[0],
      formatted: formatted.trimEnd()
    }))
  })
}

function registerStyle(config: CslConfig, style: CitationFormatterRequest['style']): string {
  if (style.customXml !== undefined) {
    assertInTextCslStyle(style.customXml)
    config.styles.add(style.styleId, style.customXml)
    return style.styleId
  }
  if (style.styleId === 'ieee' && !config.styles.has(IEEE_STYLE_ID)) {
    config.styles.add(IEEE_STYLE_ID, IEEE_STYLE)
    return IEEE_STYLE_ID
  }
  if (style.styleId === 'ieee') return IEEE_STYLE_ID
  if (!config.styles.has(style.styleId)) throw new Error('CSL style is unavailable')
  return style.styleId
}

export function assertInTextStyle(xml: string): void {
  assertInTextCslStyle(xml)
}
