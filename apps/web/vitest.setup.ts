import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only registers this automatically when Vitest globals are on.
afterEach(cleanup);
