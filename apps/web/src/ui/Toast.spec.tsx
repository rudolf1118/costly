import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe';
import { Button } from './Button';
import { TOAST_DURATION_MS, type ToastOptions, ToastProvider, useToast } from './Toast';

function Trigger({ options }: { options: ToastOptions }) {
  const toast = useToast();
  return <Button onClick={() => toast(options)}>Archive</Button>;
}

function renderWithToasts(options: ToastOptions) {
  return render(
    <ToastProvider>
      <Trigger options={options} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('shows a toast politely, without taking focus', async () => {
    renderWithToasts({ title: 'Account archived', description: 'Main bank account' });
    const trigger = screen.getByRole('button', { name: 'Archive' });

    await userEvent.click(trigger);

    expect(screen.getByText('Account archived')).toBeTruthy();
    // Radix announces through a separate, short-lived polite live region.
    await waitFor(() => {
      const announcement = screen.getByRole('status');
      expect(announcement.getAttribute('aria-live')).toBe('polite');
      expect(announcement.textContent).toMatch(/Account archived\s*Main bank account/);
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('runs its action and closes', async () => {
    const onAction = vi.fn();
    renderWithToasts({ title: 'Account archived', action: { label: 'Undo', onAction } });

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('Account archived')).toBeNull());
  });

  it('can be dismissed', async () => {
    renderWithToasts({ title: 'Saved' });

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('closes by itself after six seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithToasts({ title: 'Saved' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByText('Saved')).toBeTruthy();

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 500));
    expect(screen.getByText('Saved')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1500));
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('keeps at most three toasts', async () => {
    renderWithToasts({ title: 'Saved' });
    const trigger = screen.getByRole('button', { name: 'Archive' });

    for (let i = 0; i < 5; i++) await userEvent.click(trigger);

    expect(screen.getAllByText('Saved')).toHaveLength(3);
  });

  it('refuses to be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithToasts({
      title: 'Account archived',
      action: { label: 'Undo', onAction: () => {} },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await axeViolations(container.ownerDocument.body)).toEqual([]);
  });
});
