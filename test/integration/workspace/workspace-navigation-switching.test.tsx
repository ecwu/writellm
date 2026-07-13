import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import {
  navigationProject,
  PersistentOwnerFixture,
} from '../../fixtures/workspace/workspace-navigation-fixtures';

test('100 category switches preserve first-visited owner DOM identity, drafts and final intent', () => {
  const view = render(
    <WorkspaceShell
      project={navigationProject}
      sections={<PersistentOwnerFixture label="Sections draft" />}
      knowledgeBase={<PersistentOwnerFixture label="Knowledge draft" />}
      settings={(close) => (
        <main>
          <button type="button" onClick={close}>
            Close settings
          </button>
        </main>
      )}
      onLeaveWorkspace={() => {}}
    />,
  );
  const button = (name: string) =>
    [...view.container.querySelectorAll('button')].find(
      (item) => item.getAttribute('aria-label') === name,
    )!;
  const sections = view.container.querySelector('input') as HTMLInputElement;
  sections.value = 'dirty section';
  for (let index = 0; index < 100; index += 1)
    fireEvent.click(button(index % 2 ? 'Sections' : 'Knowledge Base'));
  fireEvent.click(button('Knowledge Base'));
  const knowledge = view.container.querySelectorAll('input')[1] as HTMLInputElement;
  knowledge.value = 'dirty source';
  fireEvent.click(button('Sections'));
  expect(view.container.querySelector('input')).toBe(sections);
  expect(sections.value).toBe('dirty section');
  fireEvent.click(button('Knowledge Base'));
  expect(view.container.querySelectorAll('input')[1]).toBe(knowledge);
  expect(knowledge.value).toBe('dirty source');
  expect(button('Knowledge Base').getAttribute('aria-pressed')).toBe('true');
});
