import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthStatus } from './HealthStatus';

const API = 'http://localhost:3100';

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

const upReport = {
  status: 'ok',
  details: { database: { status: 'up' }, redis: { status: 'up' } },
};

describe('HealthStatus', () => {
  it('shows the API address while the check is in flight', () => {
    respondWith(200, upReport);

    render(<HealthStatus apiBaseUrl={API} />);

    expect(screen.getByText(`Checking ${API}…`)).toBeDefined();
  });

  it('lists the dependencies when the API is healthy', async () => {
    respondWith(200, upReport);

    render(<HealthStatus apiBaseUrl={API} />);

    expect(await screen.findByText('The API is healthy.')).toBeDefined();
    expect(screen.getByText('database: up')).toBeDefined();
    expect(screen.getByText('redis: up')).toBeDefined();
  });

  it('names the failing dependency when the API answers 503', async () => {
    respondWith(503, {
      status: 'error',
      details: { database: { status: 'up' }, redis: { status: 'down' } },
    });

    render(<HealthStatus apiBaseUrl={API} />);

    expect(await screen.findByText('The API is running, but a dependency is down.')).toBeDefined();
    expect(screen.getByText('redis: down')).toBeDefined();
  });

  it('explains the failure when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    render(<HealthStatus apiBaseUrl={API} />);

    expect(
      await screen.findByText(`The API at ${API} could not be reached: Failed to fetch.`),
    ).toBeDefined();
  });

  it('checks again when the button is pressed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(new Response(JSON.stringify(upReport), { status: 200 })),
    );

    render(<HealthStatus apiBaseUrl={API} />);
    await screen.findByText(`The API at ${API} could not be reached: Failed to fetch.`);

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('The API is healthy.')).toBeDefined();
  });
});
