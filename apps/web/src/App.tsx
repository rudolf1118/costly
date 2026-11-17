import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createAppRouter } from './app/router';

export function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  // One router for the app's lifetime.
  const [router] = useState(() => createAppRouter({ apiBaseUrl }));
  return <RouterProvider router={router} />;
}
