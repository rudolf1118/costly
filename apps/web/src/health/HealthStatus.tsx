import { useEffect, useState } from 'react';
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
    <section>
      <h2>API health</h2>
      <Summary view={view} apiBaseUrl={apiBaseUrl} />
      <button type="button" onClick={() => setAttempt((previous) => previous + 1)}>
        Check again
      </button>
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
    <ul>
      {Object.entries(report.details).map(([name, dependency]) => (
        <li key={name}>
          {name}: {dependency.status}
        </li>
      ))}
    </ul>
  );
}
