import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/noto-sans-armenian';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readApiBaseUrl } from './config';
import { ThemeProvider } from './theme/ThemeProvider';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html is missing the #root element');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App apiBaseUrl={readApiBaseUrl(import.meta.env)} />
    </ThemeProvider>
  </StrictMode>,
);
