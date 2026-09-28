import { HealthStatus } from './health/HealthStatus';

export function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  return (
    <main>
      <h1>Costly</h1>
      <HealthStatus apiBaseUrl={apiBaseUrl} />
    </main>
  );
}
