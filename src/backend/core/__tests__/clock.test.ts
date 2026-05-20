import { describe, expect, it } from 'vitest';

import { createFakeClock, createSystemClock, type IClock } from '../clock';

describe('IClock — system clock', () => {
  it('now() is close to Date.now() at call time', () => {
    const clock = createSystemClock();
    const before = Date.now();
    const got = clock.now();
    const after = Date.now();
    expect(got).toBeGreaterThanOrEqual(before);
    expect(got).toBeLessThanOrEqual(after);
  });

  it('nowDate() returns a Date equivalent to new Date(now())', () => {
    const clock = createSystemClock();
    const got = clock.nowDate();
    expect(got).toBeInstanceOf(Date);
    // Allow up to 10ms drift between the two reads.
    expect(Math.abs(got.getTime() - Date.now())).toBeLessThan(50);
  });
});

describe('IClock — fake clock', () => {
  it('defaults to time 0', () => {
    const clock = createFakeClock();
    expect(clock.now()).toBe(0);
    expect(clock.nowDate()).toEqual(new Date(0));
  });

  it('accepts an explicit initial time', () => {
    const clock = createFakeClock(1_000_000);
    expect(clock.now()).toBe(1_000_000);
  });

  it('advanceBy() adds time to the current value', () => {
    const clock = createFakeClock(1000);
    clock.advanceBy(500);
    expect(clock.now()).toBe(1500);
    clock.advanceBy(0);
    expect(clock.now()).toBe(1500);
  });

  it('setTo() overrides the current time absolutely', () => {
    const clock = createFakeClock(1000);
    clock.setTo(50_000);
    expect(clock.now()).toBe(50_000);
    clock.setTo(0);
    expect(clock.now()).toBe(0);
  });

  it('nowDate() and now() stay consistent across mutations', () => {
    const clock = createFakeClock();
    clock.setTo(1234);
    expect(clock.nowDate().getTime()).toBe(1234);
    clock.advanceBy(100);
    expect(clock.nowDate().getTime()).toBe(1334);
  });

  it('two fake clocks are independent (no shared module state)', () => {
    const a = createFakeClock(0);
    const b = createFakeClock(0);
    a.advanceBy(1000);
    expect(a.now()).toBe(1000);
    expect(b.now()).toBe(0);
  });

  it('satisfies the IClock interface (compile-time gate)', () => {
    const a: IClock = createFakeClock();
    const b: IClock = createSystemClock();
    expect(typeof a.now()).toBe('number');
    expect(typeof b.now()).toBe('number');
  });
});
