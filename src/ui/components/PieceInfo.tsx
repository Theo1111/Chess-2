import {
  getPieceDefinition,
  hasAbility,
  jailerRange,
  opposite,
  type GameState,
  type Square,
} from '../../engine';
import { PieceIcon } from '../pieces/PieceIcon';

interface PieceInfoProps {
  game: GameState;
  selected: Square | null;
  /** Legal moves currently offered for the selected piece. */
  moveCount: number;
  captureCount: number;
}

/**
 * Live status for the selected piece: its identity plus whatever dynamic
 * state its abilities carry (Jailer range, Champion armour, Avenger
 * inheritance, Warhound bloodlust, Jester origin…).
 */
export function PieceInfo({ game, selected, moveCount, captureCount }: PieceInfoProps) {
  if (selected === null) return null;
  const piece = game.board[selected];
  if (!piece) return null;

  const definition = getPieceDefinition(piece.type);
  const lines: string[] = [];

  if (piece.origin && piece.origin !== piece.type) {
    lines.push(`Originally a ${getPieceDefinition(piece.origin).name} — currently a ${definition.name}.`);
  }

  if (piece.hitPoints !== undefined) {
    lines.push(`Hit points: ${piece.hitPoints}.`);
  }

  if (definition.dynamicPatterns && piece.type === 'jailer') {
    const range = jailerRange(game, piece.color);
    lines.push(`Range: ${range} · enemy Pawns captured: ${range}.`);
  }

  if (hasAbility(definition.abilities, 'inherit-lost-patterns')) {
    const lost = [...new Set(game.captured[opposite(piece.color)])];
    lines.push(
      lost.length === 0
        ? 'No friendly pieces lost yet — it cannot move.'
        : `Inherited movement: ${lost.map((type) => getPieceDefinition(type).name).join(', ')}.`,
    );
  }

  if (definition.restrictLegalMoves && captureCount > 0) {
    lines.push('CAPTURE REQUIRED — bloodlust limits it to capturing moves.');
  }

  if (typeof definition.metadata?.kingRadius === 'number') {
    lines.push(`Bound within ${definition.metadata.kingRadius} squares of its King (area shown on the board).`);
  }

  if (hasAbility(definition.abilities, 'ambush-passers')) {
    lines.push('Guarding the highlighted squares: enemies that pass through can be ambushed.');
  }

  if (moveCount === 0) {
    lines.push('No legal moves right now.');
  }

  if (lines.length === 0 && !definition.abilityText) return null;

  return (
    <section className="panel pieceinfo">
      <h2 className="panel__title">
        <span className="pieceinfo__title">
          <span className="pieceinfo__icon">
            <PieceIcon type={piece.type} color={piece.color} />
          </span>
          {definition.name}
        </span>
      </h2>
      <div className="pieceinfo__body">
        {definition.abilityText && <p className="pieceinfo__ability">{definition.abilityText}</p>}
        {lines.map((line, index) => (
          <p key={index} className="pieceinfo__line">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
