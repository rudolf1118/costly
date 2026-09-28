export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'error';
  details: Record<string, { status: DependencyStatus; message?: string }>;
}

/**
 * `GET /health` answers 200 when every dependency is up and 503 when one is
 * down, and both responses carry the same report. Anything else — a network
 * failure, a proxy error page — means the API itself could not be reached.
 */
export type HealthResult =
  | { state: 'healthy'; report: HealthReport }
  | { state: 'degraded'; report: HealthReport }
  | { state: 'unreachable'; reason: string };

export async function fetchHealth(apiBaseUrl: string, signal?: AbortSignal): Promise<HealthResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/health`, { signal });
  } catch (error) {
    return { state: 'unreachable', reason: describe(error) };
  }

  if (response.status !== 200 && response.status !== 503) {
    return { state: 'unreachable', reason: `the API answered with HTTP ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: 'unreachable', reason: 'the API response was not valid JSON' };
  }

  if (!isHealthReport(body)) {
    return { state: 'unreachable', reason: 'the API response was not a health report' };
  }

  return { state: response.status === 200 ? 'healthy' : 'degraded', report: body };
}

function isHealthReport(value: unknown): value is HealthReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<HealthReport>;
  return (
    (candidate.status === 'ok' || candidate.status === 'error') &&
    typeof candidate.details === 'object' &&
    candidate.details !== null
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
