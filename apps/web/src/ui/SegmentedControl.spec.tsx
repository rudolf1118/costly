import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test/axe';
import { SegmentedControl } from './SegmentedControl';

const periods = [
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
] as const;
type Period = (typeof periods)[number]['value'];

function Example({ onChange }: { onChange?: (value: Period) => void }) {
  const [value, setValue] = useState<Period>('1m');
  return (
    <SegmentedControl
      label="Period"
      options={periods}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const selected = () =>
  screen
    .getAllByRole('radio')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent);

describe('SegmentedControl', () => {
  it('is a named radio group with exactly one option selected', () => {
    render(<Example />);

    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeTruthy();
    expect(selected()).toEqual(['1M']);
  });

  it('selects an option on click', async () => {
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: '1Y' }));

    expect(onChange).toHaveBeenCalledWith('1y');
    expect(selected()).toEqual(['1Y']);
  });

  it('never ends up with nothing selected', async () => {
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: '1M' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(selected()).toEqual(['1M']);
  });

  it('moves between options with the arrow keys', async () => {
    render(<Example />);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('1M');

    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('3M');
    await userEvent.keyboard('{Enter}');

    expect(selected()).toEqual(['3M']);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Example />);

    expect(await axeViolations(container)).toEqual([]);
  });
});
