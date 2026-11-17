import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { fetchHealth, type HealthReport, type HealthResult } from './health-api';

type ViewState = { state: 'loading' } | HealthResult;

export function HealthStatus({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [view, setView] = useState<ViewState>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setView({ state: 'loading' });

    void fetchHealth(apiBaseUrl, controller.signal).then((result) => {
      // An aborted request belongs to a superseded render, so its result is stale.
      if (!controller.signal.aborted) {
        setView(result);
      }
    });

    return () => controller.abort();
  }, [apiBaseUrl, attempt]);

  return (
    <section className="flex flex-col items-start gap-3">
      <h2 className="text-title-card">API health</h2>
      {/* Polite: the result is announced when it arrives, without interrupting. */}
      <div aria-live="polite" className="flex flex-col gap-2 text-body text-text-body">
        <Summary view={view} apiBaseUrl={apiBaseUrl} />
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={view.state === 'loading'}
        onClick={() => setAttempt((previous) => previous + 1)}
      >
        Check again
      </Button>
    </section>
  );
}

function Summary({ view, apiBaseUrl }: { view: ViewState; apiBaseUrl: string }) {
  switch (view.state) {
    case 'loading':
      return <p>Checking {apiBaseUrl}…</p>;
    case 'healthy':
      return (
        <>
          <p>The API is healthy.</p>
          <Dependencies report={view.report} />
        </>
      );
    case 'degraded':
      return (
        <>
          <p>The API is running, but a dependency is down.</p>
          <Dependencies report={view.report} />
        </>
      );
    case 'unreachable':
      return (
        <p>
          The API at {apiBaseUrl} could not be reached: {view.reason}.
        </p>
      );
  }
}

function Dependencies({ report }: { report: HealthReport }) {
  return (
    <ul className="flex flex-col gap-1 font-mono text-body-small text-text-secondary">
      {Object.entries(report.details).map(([name, dependency]) => (
        <li key={name}>
          {name}: {dependency.status}
        </li>
      ))}
    </ul>
  );
}
