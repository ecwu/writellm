import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SectionWorkspace } from '../../../src/renderer/features/writing-orientation/SectionWorkspace';
import type { SectionNavigationItem } from '../../../src/renderer/features/writing-orientation/orientation-state';

const items: SectionNavigationItem[] = [
  {
    id: 'linked',
    title: 'Linked section',
    summary: 'Has a durable chapter',
    status: 'in-progress',
    chapter: { kind: 'linked', chapterId: 'chapter' },
    ownerRevision: 2,
    persisted: true,
  },
  {
    id: 'draft',
    title: 'A very long unlinked planning section name',
    summary: 'Planning context remains visible without fabricated prose.',
    status: 'not-started',
    chapter: { kind: 'not-created' },
    ownerRevision: 2,
    persisted: false,
  },
];
function Harness({ initial = 'linked' }: { initial?: string | null }) {
  const [selected, setSelected] = useState(initial);
  return (
    <SectionWorkspace
      projectName="Project"
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      onAdd={() => {}}
    >
      <label>
        Owner draft
        <input defaultValue="unsaved" />
      </label>
    </SectionWorkspace>
  );
}
test('Sections exposes owner order, full names, status and chapter association without remounting detail', async () => {
  const user = userEvent.setup({ document });
  const view = render(<Harness />);
  const linked = view.getByRole('button', { name: /Linked section.*Chapter linked/ });
  expect(linked.getAttribute('aria-label')).toContain('Chapter linked');
  const input = view.getByRole('textbox', { name: 'Owner draft' });
  await user.click(
    view.getByRole('button', { name: /A very long unlinked planning section name/ }),
  );
  expect(view.getByRole('textbox', { name: 'Owner draft' })).toBe(input);
  expect(
    view
      .getByRole('button', { name: /A very long unlinked planning section name/ })
      .getAttribute('aria-label'),
  ).toContain('Chapter not created');
});
test('Sections renders a safe no-selection and empty entry path', () => {
  const view = render(
    <SectionWorkspace
      projectName="Project"
      items={[]}
      selectedId={null}
      onSelect={() => {}}
      onAdd={() => {}}
    />,
  );
  expect(view.getByText('No sections yet.')).toBeTruthy();
  expect(view.getAllByRole('button', { name: /Create first section/i }).length).toBeGreaterThan(0);
});
