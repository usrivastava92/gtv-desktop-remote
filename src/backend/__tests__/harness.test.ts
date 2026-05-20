import { describe, expect, it } from 'vitest';

/**
 * harness sanity check. Proves the vitest runner is wired up and the
 * `src/backend/` tsconfig is happy. Real tests start landing
 */
describe('backend test harness', () => {
  it('runs vitest against src/backend/', () => {
    expect(1 + 1).toBe(2);
  });

  it('respects strict TypeScript settings', () => {
    const value: number = Number.parseInt('42', 10);
    expect(value).toBe(42);
  });
});
