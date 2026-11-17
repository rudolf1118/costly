import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/noto-sans-armenian';
import '../styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../theme/ThemeProvider';
import { UiPreview } from './UiPreview';

const container = document.getElementById('root');
if (!container) throw new Error('ui.html is missing the #root element');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <UiPreview />
    </ThemeProvider>
  </StrictMode>,
);
