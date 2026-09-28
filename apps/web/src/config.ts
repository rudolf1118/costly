/**
 * The API is served from its own origin, so its address is configuration rather
 * than a constant. A missing value fails immediately at startup, the same way
 * the API refuses to boot without a valid environment.
 */
export function readApiBaseUrl(env: { VITE_API_URL?: string | undefined }): string {
  const value = env.VITE_API_URL?.trim();
  if (!value) {
    throw new Error('VITE_API_URL is not set. Copy apps/web/.env.example to apps/web/.env.');
  }
  return value.replace(/\/+$/, '');
}
