import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * — renderer test bootstrap.
 *
 * - `@testing-library/jest-dom/vitest` extends vitest's `expect` with
 *   matchers like `.toBeInTheDocument()` / `.toHaveTextContent()` for
 *   ergonomic DOM assertions in renderer tests.
 * - `cleanup()` after each test unmounts every component rendered during
 *   the test so the next test starts with a fresh jsdom body. Without
 *   this, accumulated <div>s leak across tests and selectors find stale
 *   elements.
 */
afterEach(() => {
  cleanup();
});
