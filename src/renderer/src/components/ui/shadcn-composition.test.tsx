import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'
import { Field, FieldDescription, FieldLabel } from './field'
import { Input } from './input'
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireProgress,
  QuestionnaireTitle
} from './questionnaire'
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

  it('keeps Questionnaire navigation and native radio semantics accessible', () => {
    const html = renderToStaticMarkup(
      <Questionnaire
        items={[
          {
            name: 'scope',
            required: true,
            choices: [{ value: 'Section' }, { value: 'Document' }]
          }
        ]}
      >
        <QuestionnaireProgress
          render={(progressProps, state) => (
            <span {...progressProps}>{`Question ${state.current} of ${state.total}`}</span>
          )}
        />
        <QuestionnaireItem name='scope' required>
          <QuestionnaireTitle>Which scope should be used?</QuestionnaireTitle>
          <QuestionnaireChoices>
            <QuestionnaireChoice value='Section'>Section</QuestionnaireChoice>
            <QuestionnaireChoice value='Document'>Document</QuestionnaireChoice>
            <QuestionnaireInput placeholder='Enter another answer' />
          </QuestionnaireChoices>
        </QuestionnaireItem>
      </Questionnaire>
    )

    expect(html).toContain('<fieldset')
    expect(html).toContain('<legend')
    expect(html).toContain('type="radio"')
    expect(html).toContain('Question 1 of 1')
    expect(html).toContain('Enter another answer')
  })
})
