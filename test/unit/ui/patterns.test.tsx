import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../../../src/renderer/components/patterns/EmptyState';
import { FormField } from '../../../src/renderer/components/patterns/FormField';
import { StatusNotice } from '../../../src/renderer/components/patterns/StatusNotice';
import { Input } from '../../../src/renderer/components/ui/input';

test('patterns expose relationships, non-color status meaning, and headings', () => {
  const html = renderToStaticMarkup(
    <>
      <FormField label="Name" description="Required" error="Invalid">
        <Input />
      </FormField>
      <StatusNotice tone="error">Failed</StatusNotice>
      <EmptyState title="Nothing here" description="Create one" />
    </>,
  );
  expect(html).toContain('<label');
  expect(html).toContain('aria-describedby');
  expect(html).toContain('role="alert"');
  expect(html).toContain('>Nothing here</h3>');
});
