import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FILE_COUNT,
  RANK_COUNT,
  getPieceDefinition,
  makeSquare,
  squareName,
  type Color,
} from '../../engine';
import {
  autoPlace,
  clearPlacement,
  isMandatory,
  isReadyToPlay,
  isStartingSquare,
  placeUnit,
  throneSquare,
  unitAt,
  unplaceUnit,
  unplacedUnits,
  validatePlacement,
  type Roster,
  type RosterUnit,
} from '../../roster';
import { PieceIcon } from '../pieces/PieceIcon';

interface PlacementScreenProps {
  color: Color;
  roster: Roster;
  onChange: (roster: Roster) => void;
  onConfirm: () => void;
  onBack: () => void;
}

const RANKS = Array.from({ length: RANK_COUNT }, (_, index) => RANK_COUNT - 1 - index);
const FILES = Array.from({ length: FILE_COUNT }, (_, index) => index);

/**
 * Deployment: drag (or click-click) each unit onto any square in the player's
 * first two rows. Pieces can be picked up from the tray or moved between
 * squares; clicking a placed piece returns it to the tray.
 *
 * The King is the exception. It keeps its traditional seat — e1 for White,
 * e9 for Black — so it is rendered fixed there and cannot be picked up: that
 * square is what makes castling possible, and the roster layer refuses to
 * move it anyway.
 */
export function PlacementScreen({ color, roster, onChange, onConfirm, onBack }: PlacementScreenProps) {
  const [held, setHeld] = useState<RosterUnit | null>(null);
  const heldRef = useRef<RosterUnit | null>(null);
  /** Square the held unit was picked up from, to tell a click from a drag. */
  const pickupSquareRef = useRef<number | null>(null);
  const throne = throneSquare(color);
  const tray = unplacedUnits(roster);
  const ready = isReadyToPlay(roster);
  const placementErrors = validatePlacement(roster);

  const pick = (unit: RosterUnit | null) => {
    heldRef.current = unit;
    setHeld(unit);
  };

  // Drop resolution mirrors the game board: wherever the pointer is released,
  // the nearest data-square (or the tray) decides what happens.
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const unit = heldRef.current;
      if (!unit) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const squareTarget = element?.closest<HTMLElement>('[data-square]');
      const trayTarget = element?.closest<HTMLElement>('[data-tray]');
      const wasPlaced = roster.placement[unit.id] !== undefined;

      if (squareTarget) {
        const square = Number(squareTarget.dataset.square);
        if (square === pickupSquareRef.current) {
          // Released where it was picked up: that's a click, keep holding.
          pickupSquareRef.current = null;
          return;
        }
        if (Number.isInteger(square) && isStartingSquare(color, square)) {
          onChange(placeUnit(roster, unit.id, square));
          pick(null);
        }
        // Released over an illegal square: keep holding for click-to-place.
        return;
      }

      if (trayTarget) {
        // Dropping a placed piece on the tray unplaces it. Releasing over the
        // tray with an already-unplaced piece is just the pick-up click —
        // keep holding it so the player can click a square next.
        if (wasPlaced) {
          onChange(unplaceUnit(roster, unit.id));
          pick(null);
        }
        return;
      }

      pick(null); // released somewhere unrelated
    };
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [roster, color, onChange]);

  const placedCount = roster.units.length - tray.length;

  /** Name of the unit being held or hovered, shown above the board. */
  const heldName = held ? getPieceDefinition(held.type).name : null;

  const zoneLabel = useMemo(
    () => (color === 'white' ? 'ranks 1–2' : 'ranks 7–8'),
    [color],
  );

  return (
    <div className="screen">
      <header className="screen__header">
        <button type="button" className="button button--ghost screen__back" onClick={onBack}>
          ← Army
        </button>
        <div>
          <h1 className="screen__title">Place your army</h1>
          <p className="screen__subtitle">
            <span className={`swatch swatch--${color}`} /> {color === 'white' ? 'White' : 'Black'} ·
            drop pieces anywhere on your {zoneLabel} · {placedCount}/{roster.units.length} placed
          </p>
        </div>
      </header>

      <div className="placement">
        <div className="placement__board">
          <div className="board-frame">
            <div className="board" role="grid" aria-label="Deployment board">
              {RANKS.map((rank) =>
                FILES.map((file) => {
                  const square = makeSquare(file, rank);
                  const unit = unitAt(roster, square);
                  const isThrone = square === throne;
                  const legal = isStartingSquare(color, square) && !isThrone;
                  const classes = [
                    'square',
                    // Matches the board artwork: a1 is a light square.
                    (file + rank) % 2 === 0 ? 'square--light' : 'square--dark',
                    legal ? 'square--zone' : '',
                    legal && held ? 'square--zone-active' : '',
                    isThrone ? 'square--throne' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');

                  return (
                    <button
                      key={square}
                      type="button"
                      role="gridcell"
                      data-square={square}
                      className={classes}
                      aria-label={`${squareName(square)}${
                        isThrone ? ', the throne' : ''
                      }${unit ? `, ${getPieceDefinition(unit.type).name}` : ''}`}
                      title={isThrone ? `The King holds ${squareName(throne)}` : undefined}
                      onPointerDown={() => {
                        if (held && legal && held.id !== unit?.id) {
                          // click-to-place: second click drops the held piece
                          onChange(placeUnit(roster, held.id, square));
                          pick(null);
                          return;
                        }
                        // The King is not for moving, so it is not for picking up.
                        if (unit && !isMandatory(unit)) {
                          pickupSquareRef.current = square;
                          pick(unit);
                        }
                      }}
                    >
                      {unit && (
                        <span
                          className={`square__piece${held?.id === unit.id ? ' square__piece--held' : ''}`}
                        >
                          <PieceIcon type={unit.type} color={color} />
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          <p className="placement__status" aria-live="polite">
            {heldName
              ? `Placing: ${heldName}`
              : ready
                ? 'Army deployed. Ready when you are.'
                : (placementErrors[0]?.message ?? '')}
          </p>
        </div>

        <aside className="placement__side">
          <section className="panel" data-tray>
            <h2 className="panel__title">Unplaced pieces</h2>
            {tray.length === 0 ? (
              <p className="placement__empty">Everything is on the board.</p>
            ) : (
              <ul className="tray">
                {tray.map((unit) => (
                  <li key={unit.id}>
                    <button
                      type="button"
                      className={`tray__piece${held?.id === unit.id ? ' tray__piece--held' : ''}`}
                      onPointerDown={() => {
                        pickupSquareRef.current = null;
                        pick(unit);
                      }}
                    >
                      <PieceIcon type={unit.type} color={color} />
                      <span>{getPieceDefinition(unit.type).name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="placement__hint">
              Drag a piece onto the highlighted squares, or click it and then click a square.
              Click a placed piece to pick it back up; drop it here to unplace it. Your King
              holds {squareName(throne)} and cannot be moved — keep a piece in a corner and it
              can castle with whatever is standing there.
            </p>
          </section>

          <div className="controls">
            <button type="button" className="button" onClick={() => onChange(autoPlace(roster))}>
              Auto-place
            </button>
            <button type="button" className="button" onClick={() => onChange(clearPlacement(roster))}>
              Clear
            </button>
          </div>

          <button
            type="button"
            className="button button--primary placement__confirm"
            disabled={!ready}
            onClick={onConfirm}
          >
            {color === 'white' ? 'Confirm — Black builds next →' : 'Confirm & start the match →'}
          </button>
        </aside>
      </div>
    </div>
  );
}
