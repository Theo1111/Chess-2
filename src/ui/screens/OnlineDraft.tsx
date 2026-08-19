import { useMemo, useState } from 'react';
import type { Color } from '../../engine';
import {
  DEFAULT_ROSTER_BUDGET,
  autoPlace,
  createRoster,
  isCompositionLegal,
  type Roster,
} from '../../roster';
import { TeamBuilder } from './TeamBuilder';

interface OnlineDraftProps {
  color: Color;
  secondsLeft: number | null;
  submitted: boolean;
  opponentName: string;
  onSubmit: (roster: Roster) => void;
  onLeave: () => void;
}

/**
 * The 60-second army draft that follows a custom-mode pairing.
 *
 * Deployment is auto-placed on submit rather than given its own step: a
 * minute is enough to choose an army, not to arrange it square by square,
 * and a half-finished placement would be worse than a tidy default.
 *
 * The countdown here is advisory — `submit_online_army` re-checks the
 * deadline server-side, so the match is decided by the server's clock, not
 * by whichever client is slowest or has been tampered with.
 */
export function OnlineDraft({
  color,
  secondsLeft,
  submitted,
  opponentName,
  onSubmit,
  onLeave,
}: OnlineDraftProps) {
  const [roster, setRoster] = useState<Roster>(() => createRoster(color, DEFAULT_ROSTER_BUDGET));
  const ready = isCompositionLegal(roster);
  const urgent = secondsLeft !== null && secondsLeft <= 15;

  const banner = useMemo(() => {
    if (submitted) return `Army locked in — waiting for ${opponentName}…`;
    if (secondsLeft === null) return 'Draft your army.';
    return `${secondsLeft}s to draft your army`;
  }, [submitted, secondsLeft, opponentName]);

  return (
    <div className="online-draft">
      <div className={`online-draft__bar${urgent && !submitted ? ' online-draft__bar--urgent' : ''}`}>
        <span className="online-draft__clock">{banner}</span>
        <span className="online-draft__note">
          {submitted
            ? 'The match starts as soon as both armies are in.'
            : 'Pieces deploy automatically — the match is cancelled if you run out of time.'}
        </span>
        <div className="online-draft__actions">
          <button type="button" className="button button--ghost" onClick={onLeave}>
            Leave
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!ready || submitted}
            onClick={() => onSubmit(autoPlace(roster))}
          >
            {submitted ? 'Submitted' : 'Lock in army'}
          </button>
        </div>
      </div>

      <TeamBuilder
        color={color}
        roster={roster}
        onChange={setRoster}
        onConfirm={() => onSubmit(autoPlace(roster))}
        onBack={onLeave}
      />
    </div>
  );
}
