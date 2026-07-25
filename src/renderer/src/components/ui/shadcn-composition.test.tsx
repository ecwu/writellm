import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'
import { Field, FieldDescription, FieldLabel } from './field'
import { Input } from './input'
import { Spinner } from './spinner'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

describe('shadcn renderer compositions', () => {
  it('preserves invalid form semantics through Field and its control', () => {
    const html = renderToStaticMarkup(
      <Field data-invalid>
        <FieldLabel htmlFor='model-id'>Model ID</FieldLabel>
        <Input id='model-id' aria-invalid />
        <FieldDescription>Choose a valid model.</FieldDescription>
      </Field>
    )

    expect(html).toContain('data-invalid="true"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('for="model-id"')
  })

  it('renders a single-value ToggleGroup with an accessible selected option', () => {
    const html = renderToStaticMarkup(
      <ToggleGroup type='single' defaultValue='section' aria-label='Agent context scope'>
        <ToggleGroupItem value='selection'>Selection</ToggleGroupItem>
        <ToggleGroupItem value='section'>Section</ToggleGroupItem>
      </ToggleGroup>
    )

    expect(html).toContain('aria-label="Agent context scope"')
    expect(html).toContain('data-state="on"')
    expect(html).toContain('Section')
  })

  it('keeps loading and collapsible details machine-readable', () => {
    const html = renderToStaticMarkup(
      <>
        <Spinner />
        <Collapsible defaultOpen>
          <CollapsibleTrigger>Details</CollapsibleTrigger>
          <CollapsibleContent>Full value</CollapsibleContent>
        </Collapsible>
      </>
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
    expect(html).toContain('Full value')
  })
})
