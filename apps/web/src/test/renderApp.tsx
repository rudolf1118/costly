import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { createAppRouter } from '../app/router';
import { ThemeProvider } from '../theme/ThemeProvider';

export const TEST_API = 'http://api.test';

/**
 * Renders the whole app at a path, with an in-memory history, and waits for
 * the router to settle on its first page.
 */
export async function renderApp(path = '/') {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createAppRouter({ apiBaseUrl: TEST_API }, history);
  const result = render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
  return { ...result, router, history };
}
