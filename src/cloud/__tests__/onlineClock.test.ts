import { describe, expect, it } from 'vitest';
import { projectOnlineClock, type ClockRow } from '../onlineClock';

const T0 = Date.parse('2026-08-24T12:00:00.000Z');

const row = (overrides: Partial<ClockRow> = {}): ClockRow => ({
  status: 'active',
  turn: 'white',
  white_ms: 300_000,
  black_ms: 300_000,
  turn_started_at: new Date(T0).toISOString(),
  winner: null,
  reason: null,
  ...overrides,
});

describe('projectOnlineClock', () => {
  it('is disabled for an untimed game', () => {
    const clock = projectOnlineClock(row({ white_ms: null, black_ms: null }), T0);
    expect(clock.enabled).toBe(false);
    expect(clock.running).toBe(false);
  });

  it('burns only the mover’s clock', () => {
    const clock = projectOnlineClock(row(), T0 + 10_000);
    expect(clock.remaining.white).toBe(290_000);
    expect(clock.remaining.black).toBe(300_000); // untouched while waiting
    expect(clock.flagged).toBeNull();
    expect(clock.running).toBe(true);
  });

  it('never reads below zero, and flags the side that ran out', () => {
    const clock = projectOnlineClock(row({ white_ms: 4_000 }), T0 + 9_000);
    expect(clock.remaining.white).toBe(0);
    expect(clock.flagged).toBe('white');
  });

  it('holds still while the game is not live', () => {
    const drafting = projectOnlineClock(row({ status: 'drafting', turn_started_at: null }), T0 + 60_000);
    expect(drafting.remaining.white).toBe(300_000);
    expect(drafting.running).toBe(false);
    expect(drafting.flagged).toBeNull();
  });

  it('reads a finished game’s stored numbers, and who lost on time', () => {
    const finished = projectOnlineClock(
      row({ status: 'finished', winner: 'black', reason: 'timeout', white_ms: 0 }),
      T0 + 600_000,
    );
    expect(finished.remaining.white).toBe(0);
    expect(finished.remaining.black).toBe(300_000); // not burned after the end
    expect(finished.flagged).toBe('white');
    expect(finished.running).toBe(false);
  });

  it('a game that ended some other way has no flag', () => {
    const finished = projectOnlineClock(
      row({ status: 'finished', winner: 'white', reason: 'checkmate' }),
      T0 + 600_000,
    );
    expect(finished.flagged).toBeNull();
  });

  it('a clock the server has not started yet does not tick', () => {
    const clock = projectOnlineClock(row({ turn_started_at: null }), T0 + 30_000);
    expect(clock.remaining).toEqual({ white: 300_000, black: 300_000 });
  });
});
