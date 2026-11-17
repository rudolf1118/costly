import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../test/axe';
import { TextField } from './TextField';

describe('TextField', () => {
  it('is labelled by its visible label', async () => {
    render(<TextField label="Email" type="email" />);

    const input = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.type(input, 'anna@example.com');

    expect((input as HTMLInputElement).value).toBe('anna@example.com');
  });

  it('describes the field with its hint', () => {
    render(<TextField label="Name" hint="Up to 64 characters" />);

    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-describedby')).toBe(
      screen.getByText('Up to 64 characters').closest('p')?.id,
    );
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
  });

  it('marks the field invalid and replaces the hint with the error', () => {
    render(<TextField label="Name" hint="Up to 64 characters" error="Give the account a name" />);
    const input = screen.getByRole('textbox', { name: 'Name' });

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Up to 64 characters')).toBeNull();
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Give the account a name');
  });

  it('keeps ids unique across several fields', () => {
    render(
      <>
        <TextField label="One" hint="a" />
        <TextField label="Two" hint="b" />
      </>,
    );

    const [one, two] = screen.getAllByRole('textbox');
    expect(one?.id).not.toBe(two?.id);
    expect(one?.getAttribute('aria-describedby')).not.toBe(two?.getAttribute('aria-describedby'));
  });

  it('honours a given id and forwards its ref to the input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} id="opening-balance" label="Opening balance" suffix="֏" />);

    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'Opening balance' }));
    expect(ref.current?.id).toBe('opening-balance');
    expect(screen.getByText('֏')).toBeTruthy();
  });

  it('has no accessibility violations, with or without an error', async () => {
    const { container } = render(
      <>
        <TextField label="Email" hint="We never share it" />
        <TextField label="Password" type="password" error="Must be at least 8 characters" />
        <TextField label="Currency" value="AMD" disabled readOnly />
      </>,
    );

    expect(await axeViolations(container)).toEqual([]);
  });
});
