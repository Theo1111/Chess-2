import type { Color, GameState } from '../../engine';

interface StatusPanelProps {
  game: GameState;
}

interface StatusText {
  headline: string;
  detail: string;
  tone: 'normal' | 'check' | 'over';
}

const colorName = (color: Color): string => (color === 'white' ? 'White' : 'Black');

/** Maps engine status to player-facing copy. All wording lives here. */
export function describeStatus(game: GameState): StatusText {
  const mover = colorName(game.turn);
  switch (game.status) {
    case 'checkmate':
      return {
        headline: `${colorName(game.winner ?? 'white')} wins`,
        detail: `Checkmate — ${mover.toLowerCase()} has no legal moves.`,
        tone: 'over',
      };
    case 'assassin-victory':
      return {
        headline: `${colorName(game.winner ?? 'white')} wins`,
        detail: "An Assassin reached the opponent's back row.",
        tone: 'over',
      };
    case 'annihilation':
      return {
        headline: game.winner ? `${colorName(game.winner)} wins` : 'Draw',
        detail: game.winner
          ? 'Nothing is left standing but their King.'
          : 'Nothing is left standing at all.',
        tone: 'over',
      };
    case 'stalemate':
      return { headline: 'Draw', detail: `Stalemate — ${mover.toLowerCase()} has no legal moves.`, tone: 'over' };
    case 'draw-fifty-move':
      return { headline: 'Draw', detail: 'Fifty moves without a capture or pawn move.', tone: 'over' };
    case 'draw-threefold-repetition':
      return { headline: 'Draw', detail: 'The same position occurred three times.', tone: 'over' };
    case 'draw-insufficient-material':
      return { headline: 'Draw', detail: 'Neither side has enough material to mate.', tone: 'over' };
    case 'check':
      return { headline: `${mover} to move`, detail: `${mover} is in check.`, tone: 'check' };
    default:
      if (game.phase === 'bonus') {
        return {
          headline: `${mover} — free move`,
          detail: 'The Duelist may take one extra move, or pass.',
          tone: 'normal',
        };
      }
      return { headline: `${mover} to move`, detail: `Move ${game.fullmoveNumber}`, tone: 'normal' };
  }
}

export function StatusPanel({ game }: StatusPanelProps) {
  const status = describeStatus(game);

  return (
    <section className={`status status--${status.tone}`} aria-live="polite">
      <span className={`status__turn status__turn--${game.turn}`} aria-hidden="true" />
      <div className="status__text">
        <h2 className="status__headline">{status.headline}</h2>
        <p className="status__detail">{status.detail}</p>
      </div>
    </section>
  );
}
