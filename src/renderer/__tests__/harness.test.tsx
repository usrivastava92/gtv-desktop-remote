import { act, renderHook, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

/**
 * harness smoke tests. Same role as the backend
 * `src/backend/__tests__/harness.test.ts` — proves the renderer test
 * environment (jsdom + React 18 + @testing-library/react + jest-dom
 * matchers) is wired up end-to-end so subsequent PRs that extract real
 * hooks and components from `App.tsx` can be tested against this harness.
 *
 * Intentionally exercises an inline counter hook and an inline
 * component — no production renderer code is touched here. Real hook
 * tests land alongside their extractions in later PRs.
 */

function useCounter(initial = 0): { count: number; increment: () => void } {
  const [count, setCount] = useState(initial);
  return {
    count,
    increment: (): void => {
      setCount((value) => value + 1);
    },
  };
}

describe('renderer test harness', () => {
  it('renders a React 18 component into jsdom', () => {
    render(<button type="button">Click me</button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('renderHook drives state through React concurrent runtime', () => {
    const { result } = renderHook(() => useCounter(10));
    expect(result.current.count).toBe(10);
    act(() => {
      result.current.increment();
      result.current.increment();
    });
    expect(result.current.count).toBe(12);
  });

  it('jest-dom matchers extend expect (smoke check)', () => {
    render(<input type="text" disabled aria-label="frozen" />);
    expect(screen.getByLabelText(/frozen/i)).toBeDisabled();
  });
});
