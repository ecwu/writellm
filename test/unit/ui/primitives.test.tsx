import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../../../src/renderer/components/ui/button';
import { Input } from '../../../src/renderer/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../src/renderer/components/ui/select';

test('shadcn Base UI primitives preserve roles, names, disabled and invalid state', () => {
  const html = renderToStaticMarkup(
    <>
      <Button disabled>Save</Button>
      <Input aria-label="Title" aria-invalid />
      <Select defaultValue="system">
        <SelectTrigger aria-label="Theme">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">System</SelectItem>
        </SelectContent>
      </Select>
    </>,
  );
  expect(html).toContain('<button');
  expect(html).toContain('disabled');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('data-slot="select-trigger"');
});
