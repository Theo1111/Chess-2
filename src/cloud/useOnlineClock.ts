import { useEffect, useRef, useState } from 'react';
import type { GameClock } from '../ui/useGameClock';
import { fetchServerTime, type OnlineGameRow } from './online';
import { projectOnlineClock } from './onlineClock';

/** How often the face is redrawn. The numbers themselves come from the row. */
const TICK_MS = 100;
/** Don't hammer the RPC if a claim fails (offline, or a race with the server). */
const CLAIM_RETRY_MS = 5000;

/**
 * The online match clock as React state.
 *
 * Two jobs, both thin: redraw the countdown a few times a second, and tell
 * the caller when the side to move appears to have run out. It computes
 * nothing of its own — the arithmetic is `projectOnlineClock`, and the
 * numbers it projects are the server's.
 *
 * Time is measured on the SERVER's clock: the row's stamps come from there,
 * so the hook measures its own device's offset once and corrects for it.
 * A player whose laptop is ten minutes fast still sees the true countdown.
 *
 * `onFlag` is a request, not a verdict — `claim_online_timeout` recomputes
 * the elapsed time server-side and ignores a claim that is early.
 */
export function useOnlineClock(row: OnlineGameRow | null, onFlag: () => void): GameClock {
  const [offset, setOffset] = useState(0);
  const [, redraw] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchServerTime().then((serverNow) => {
      if (!cancelled && serverNow !== null) setOffset(serverNow - Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = row?.status === 'active' && row.white_ms !== null && row.turn_started_at !== null;

  useEffect(() => {
    if (!live) return;
    const handle = window.setInterval(() => redraw((count) => count + 1), TICK_MS);
    // A hidden tab throttles timers; settle up the moment it comes back.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') redraw((count) => count + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live]);

  const clock = projectOnlineClock(row, Date.now() + offset);

  // Both players' clients ask the moment they see a flag fall; the server
  // settles it once. The cooldown keeps a failed claim from becoming a loop.
  const lastClaimRef = useRef(0);
  const flagged = clock.running ? clock.flagged : null;
  useEffect(() => {
    if (!flagged) return;
    const now = Date.now();
    if (now - lastClaimRef.current < CLAIM_RETRY_MS) return;
    lastClaimRef.current = now;
    onFlag();
  }, [flagged, onFlag]);

  return clock;
}
