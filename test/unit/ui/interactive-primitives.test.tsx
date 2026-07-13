import '../../setup/renderer-dom';
import { expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../src/renderer/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../../../src/renderer/components/ui/dialog';
import { TooltipTrigger } from '../../../src/renderer/components/ui/tooltip';

test('dialog traps focus, makes background inert, closes with Escape and restores trigger focus', async () => {
  const user = userEvent.setup({ document });
  const view = render(
    <main>
      <Button data-dialog-focus-fallback>Fallback</Button>
      <Dialog>
        <DialogTrigger>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <Button>First</Button>
          <DialogClose>
            <Button>Last</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </main>,
  );
  const open = view.getByRole('button', { name: 'Open' });
  await user.click(open);
  expect((await view.findByRole('dialog')).isConnected).toBe(true);
  await waitFor(() =>
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'First' })),
  );
  expect(document.querySelector('main')?.parentElement?.hasAttribute('inert')).toBe(true);
  view.getByRole('button', { name: 'Last' }).focus();
  await user.tab();
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'First' }));
  await user.keyboard('{Escape}');
  expect(view.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(open));
});

test('tooltip composes handlers, supports keyboard Escape and remains across pointer transition', async () => {
  let keys = 0;
  const view = render(
    <TooltipTrigger content="Help">
      <Button aria-label="Help action" onKeyDown={() => keys++}>
        ?
      </Button>
    </TooltipTrigger>,
  );
  const trigger = view.getByRole('button', { name: 'Help action' });
  fireEvent.focus(trigger);
  expect(view.getByRole('tooltip').isConnected).toBe(true);
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(keys).toBe(1);
  expect(view.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseEnter(trigger.closest('.ui-tooltip-anchor')!);
  const tooltip = view.getByRole('tooltip');
  fireEvent.mouseLeave(trigger.closest('.ui-tooltip-anchor')!);
  fireEvent.mouseEnter(tooltip);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(view.getByRole('tooltip').isConnected).toBe(true);
});

test('button exposes reusable icon sizing, target, disabled and busy semantics', () => {
  const view = render(
    <>
      <Button size="icon" aria-label="Close">
        x
      </Button>
      <Button busy>Saving</Button>
    </>,
  );
  expect(view.getByRole('button', { name: 'Close' }).className).toContain('ui-button-icon');
  const saving = view.getByRole('button', { name: 'Saving' });
  expect(saving.getAttribute('aria-busy')).toBe('true');
  expect(saving.hasAttribute('disabled')).toBe(true);
});
