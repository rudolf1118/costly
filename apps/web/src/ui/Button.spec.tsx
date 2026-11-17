import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe';
import { Button } from './Button';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Button>Cancel</Button>
      </form>,
    );

    screen.getByRole('button', { name: 'Cancel' }).click();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits when asked to', async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('applies each variant', () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="secondary">S</Button>
        <Button variant="ghost">G</Button>
        <Button variant="destructive">D</Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'P' }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'S' }).className).toContain('border-border-strong');
    expect(screen.getByRole('button', { name: 'G' }).className).toContain('text-accent-text');
    expect(screen.getByRole('button', { name: 'D' }).className).toContain('text-negative');
  });

  describe('while loading', () => {
    it('ignores clicks and announces that it is busy, keeping its name', async () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });

      await userEvent.click(button);

      expect(onClick).not.toHaveBeenCalled();
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('does not submit its form, even with Enter in a field', async () => {
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      render(
        <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
          <input aria-label="Name" />
          <Button type="submit" loading>
            Save
          </Button>
        </form>,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'x{Enter}');

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('stays focusable, so focus is not lost mid-submit', async () => {
      render(<Button loading>Save</Button>);

      await userEvent.tab();

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    });
  });

  it('can be disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('can style a link instead of a button', () => {
    render(
      <Button asChild variant="secondary">
        <a href="/accounts">Accounts</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Accounts' });
    expect(link.getAttribute('href')).toBe('/accounts');
    expect(link.className).toContain('border-border-strong');
  });

  it('has no accessibility violations in any state', async () => {
    const { container } = render(
      <>
        <Button>Add expense</Button>
        <Button variant="secondary" disabled>
          Export
        </Button>
        <Button variant="ghost" loading>
          View all
        </Button>
      </>,
    );

    expect(await axeViolations(container)).toEqual([]);
  });
});
