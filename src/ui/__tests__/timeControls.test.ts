import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_CONTROL,
  TIME_CONTROLS,
  chargeClock,
  formatClock,
  getTimeControl,
} from '../timeControls';

describe('time controls', () => {
  it('offers unlimited plus the five presets', () => {
    expect(TIME_CONTROLS.map((control) => control.id)).toEqual([
      'unlimited',
      '5',
      '10',
      '15',
      '30',
      '60',
    ]);
    expect(TIME_CONTROLS.map((control) => control.ms)).toEqual([
      null,
      300_000,
      600_000,
      900_000,
      1_800_000,
      3_600_000,
    ]);
  });

  it('resolves ids, falling back to unlimited for anything unknown', () => {
    expect(getTimeControl('30').ms).toBe(1_800_000);
    expect(getTimeControl('nonsense' as never).id).toBe('unlimited');
    expect(getTimeControl(DEFAULT_TIME_CONTROL).ms).toBeNull();
  });
});

describe('chargeClock', () => {
  const fresh = { white: 300_000, black: 300_000 };

  it('charges only the side on move', () => {
    const charge = chargeClock(fresh, 'white', 5_000);
    expect(charge.remaining).toEqual({ white: 295_000, black: 300_000 });
    expect(charge.flagged).toBeNull();
  });

  it('flags exactly at zero and never goes negative', () => {
    const charge = chargeClock({ white: 800, black: 300_000 }, 'white', 5_000);
    expect(charge.remaining.white).toBe(0);
    expect(charge.flagged).toBe('white');

    // A flagged clock stays at zero rather than drifting into negatives.
    const again = chargeClock(charge.remaining, 'white', 10_000);
    expect(again.remaining.white).toBe(0);
    expect(again.flagged).toBe('white');
  });

  it('leaves an untimed clock untouched', () => {
    const infinite = { white: Number.POSITIVE_INFINITY, black: Number.POSITIVE_INFINITY };
    const charge = chargeClock(infinite, 'black', 60_000);
    expect(charge.remaining).toBe(infinite);
    expect(charge.flagged).toBeNull();
  });

  it('ignores a backwards clock jump', () => {
    // Date.now() can step backwards (NTP correction); never refund time.
    expect(chargeClock(fresh, 'black', -4_000).remaining.black).toBe(300_000);
  });

  it('charges the real elapsed time after a long stall', () => {
    // A throttled background tab reports one big delta, not many small ones.
    const charge = chargeClock(fresh, 'black', 125_000);
    expect(charge.remaining.black).toBe(175_000);
    expect(charge.flagged).toBeNull();
  });
});

describe('formatClock', () => {
  it('renders m:ss, and tenths in the last ten seconds', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(10_000)).toBe('0:10');
    expect(formatClock(9_400)).toBe('0:09.4');
    expect(formatClock(900)).toBe('0:00.9');
  });

  it('shows hours for long controls', () => {
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_661_000)).toBe('1:01:01');
  });

  it('never renders below zero', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(-5_000)).toBe('0:00.0');
  });
});
