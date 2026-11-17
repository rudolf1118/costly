import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../test/axe';
import { Button } from './Button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './Dialog';
import { TextField } from './TextField';

function Example({ variant }: { variant?: 'modal' | 'drawer' }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Add account</Button>
      </DialogTrigger>
      <DialogContent
        title="Add account"
        description="You enter balances yourself."
        variant={variant}
      >
        <TextField label="Name" />
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens as a named, described modal dialog', async () => {
    render(<Example />);

    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    const dialog = screen.getByRole('dialog', { name: 'Add account' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('You enter balances yourself.')).toBeTruthy();
  });

  it('moves focus inside and keeps it there', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = screen.getByRole('dialog');

    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes with Escape and returns focus to the trigger', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Add account' });
    await userEvent.click(trigger);

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('closes from its close button and from a Close action', async () => {
    render(<Example />);

    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each(['modal', 'drawer'] as const)(
    'has no accessibility violations as a %s',
    async (variant) => {
      render(<Example variant={variant} />);
      await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

      expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
    },
  );
});
