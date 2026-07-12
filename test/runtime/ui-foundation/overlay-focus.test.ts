import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled fixture includes the overlay composition exercised by the DOM behavior gate', async () => {
  const fixture = await readFile('test/runtime/ui-foundation/fixture.tsx', 'utf8');
  expect(fixture).toContain('<Dialog>');
  expect(fixture).toContain('<DialogTrigger>');
  expect(fixture).toContain('<DialogContent>');
  expect(fixture).toContain('<DialogTitle>');
});
