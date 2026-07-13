import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react';
import { X } from 'lucide-react';
import { Button } from '../../../src/renderer/components/ui/button';
import { TooltipTrigger } from '../../../src/renderer/components/ui/tooltip';

test('icon-only actions have one name, a decorative SVG and focus-discoverable help', () => {
  const view = render(
    <TooltipTrigger content="Close Writing orientation">
      <Button size="icon" aria-label="Close Writing orientation">
        <X aria-hidden="true" focusable="false" />
      </Button>
    </TooltipTrigger>,
  );
  const button = view.getByRole('button', { name: 'Close Writing orientation' });
  const svg = button.querySelector('svg')!;
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('focusable')).toBe('false');
  fireEvent.focus(button);
  expect(within(document.body).getByRole('tooltip').textContent).toBe('Close Writing orientation');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(within(document.body).queryByRole('tooltip')).toBeNull();
});
