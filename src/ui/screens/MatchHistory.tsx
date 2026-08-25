import { useEffect, useState } from 'react';
import type { AccountUser } from '../../cloud/auth';
import { listMatches, type StoredMatch } from '../../cloud/storage';
import { getTimeControl, type TimeControlId } from '../timeControls';

interface MatchHistoryProps {
  user: AccountUser;
  onBack: () => void;
}

const resultText = (match: StoredMatch): string => {
  if (match.winner === 'draw') return 'Draw';
  if (match.winner) return `${match.winner === 'white' ? 'White' : 'Black'} won`;
  return 'Unfinished';
};

const reasonText: Record<string, string> = {
  checkmate: 'checkmate',
  'assassin-victory': 'assassin reached the back row',
  annihilation: 'the board was annihilated',
  stalemate: 'stalemate',
  'draw-fifty-move': 'fifty-move rule',
  'draw-threefold-repetition': 'threefold repetition',
  'draw-insufficient-material': 'insufficient material',
  timeout: 'on time',
};

export function MatchHistory({ user, onBack }: MatchHistoryProps) {
  const [matches, setMatches] = useState<readonly StoredMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMatches(user.id).then((result) => {
      if (cancelled) return;
      setMatches(result.rows);
      setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <div className="screen">
      <header className="screen__header">
        <button type="button" className="button button--ghost screen__back" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h1 className="screen__title">Match history</h1>
          <p className="screen__subtitle">{user.displayName}’s saved games</p>
        </div>
      </header>

      <section className="panel history-list">
        {matches === null && !error && <p className="history-list__empty">Loading…</p>}
        {error && <p className="history-list__empty">{error}</p>}
        {matches !== null && !error && matches.length === 0 && (
          <p className="history-list__empty">
            No games yet — finish a game while signed in and it will appear here.
          </p>
        )}
        <ul className="history-list__items">
          {(matches ?? []).map((match) => (
            <li key={match.id} className="history-list__item">
              <div className="history-list__headline">
                <strong>{resultText(match)}</strong>
                <span className="history-list__reason">
                  {reasonText[match.reason] ?? match.reason}
                </span>
              </div>
              <div className="history-list__meta">
                <span>{match.mode === 'custom' ? 'Custom armies' : 'Classic'}</span>
                <span>{getTimeControl(match.time_control as TimeControlId).label}</span>
                <span>{Math.ceil(match.plies / 2)} moves</span>
                <span>{new Date(match.played_at).toLocaleDateString()}</span>
              </div>
              {match.moves.length > 0 && (
                <p className="history-list__moves">
                  {match.moves.slice(0, 12).join(' ')}
                  {match.moves.length > 12 ? ' …' : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
