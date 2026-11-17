import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only registers this automatically when Vitest globals are on.
afterEach(cleanup);

// jsdom has no pointer capture; Radix's swipe-to-dismiss calls these.
for (const method of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, {
      configurable: true,
      value: method === 'hasPointerCapture' ? () => false : () => {},
    });
  }
}
