import { useCallback, useEffect, useRef } from 'react';
import { opposite, type GameState } from '../../engine';
import { createGameFromRosters } from '../../roster';
import type { AccountUser } from '../../cloud/auth';
import { buildMatchRow } from '../../cloud/records';
import { saveMatch } from '../../cloud/storage';
import { contentFingerprint } from '../../balance/contentFingerprint';
import type { DraftState } from '../useAppFlow';
import { Board } from '../components/Board';
import { CardActivation } from '../components/CardActivation';
import { CardHand } from '../components/CardHand';
import { CapturedPieces } from '../components/CapturedPieces';
import { ClockPanel } from '../components/ClockPanel';
import { GameControls } from '../components/GameControls';
import { MoveChoiceDialog } from '../components/MoveChoiceDialog';
import { MoveHistory } from '../components/MoveHistory';
import { PieceInfo } from '../components/PieceInfo';
import { StatusPanel, describeStatus } from '../components/StatusPanel';
import { getTimeControl, type TimeControlId } from '../timeControls';
import { useCardActivations } from '../useCardActivations';
import { useChessGame } from '../useChessGame';
import { useGameClock } from '../useGameClock';

interface GameScreenProps {
  draft: DraftState;
  timeControl: TimeControlId;
  /** Signed-in player, or null — games are only synced when signed in. */
  user: AccountUser | null;
  onExit: () => void;
}

export function GameScreen({ draft, timeControl, user, onExit }: GameScreenProps) {
  const createGame = useCallback(
    (): GameState => createGameFromRosters(draft.white, draft.black),
    [draft],
  );

  // The clock reads the game and the board reads the clock, so the lock is
  // passed as a getter over a ref: the controller can be built first and
  // still see the flag the moment it falls.
  const flaggedRef = useRef(false);
  const isLocked = useCallback(() => flaggedRef.current, []);

  const controller = useChessGame(createGame, isLocked);
  const { game, pendingChoice, chooseMove, cancelChoice, passBonus } = controller;

  const clock = useGameClock(game, timeControl, controller.gameOver);
  // A fallen flag ends the match even though the engine's position is still
  // playable — time is a match rule layered over the game, not a chess rule.
  flaggedRef.current = clock.flagged !== null;
  const gameOver = controller.gameOver || clock.flagged !== null;

  // Sync each finished game exactly once for a signed-in player. Fire and
  // forget: a failed save must never interfere with the game itself.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!gameOver || syncedRef.current || !user) return;
    syncedRef.current = true;
    const row = buildMatchRow({
      game,
      timeControl,
      override: clock.flagged
        ? { winner: opposite(clock.flagged), reason: 'timeout' }
        : null,
      armies: { white: draft.white, black: draft.black },
      contentFingerprint: contentFingerprint(),
    });
    void saveMatch(user.id, row).then((result) => {
      if (result.error) console.warn('match sync failed:', result.error);
    });
  }, [gameOver, user, game, timeControl, clock.flagged, draft]);

  const newGame = useCallback(() => {
    controller.newGame();
    clock.reset();
    syncedRef.current = false;
  }, [controller, clock]);

  const status = clock.flagged
    ? {
        headline: `${clock.flagged === 'white' ? 'Black' : 'White'} wins`,
        detail: `${clock.flagged === 'white' ? 'White' : 'Black'} ran out of time.`,
        tone: 'over' as const,
      }
    : describeStatus(game);

  const activation = useCardActivations(game);

  const selectedMoves = [...controller.movesBySquare.values()].flat();
  const selectedCaptures = selectedMoves.filter((move) => move.captured).length;

  return (
    <div className="app">
      <header className="app__header app__header--row">
        <div>
          <h1 className="app__title">
            Chess<span className="app__title-mark">2</span>
          </h1>
          <p className="app__tagline">
            Custom armies — two players, one board
            {clock.enabled && ` · ${getTimeControl(timeControl).label} each`}
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onExit}>
          Menu
        </button>
      </header>

      <main className="layout">
        <div className="layout__board">
          {/* Hot seat: the player to move is the one sitting at this side of
              the table, so their hand is the open one at the bottom. */}
          <CardHand game={game} color={opposite(game.turn)} side="opponent" />
          <CapturedPieces game={game} color="black" />
          <Board controller={controller} />
          <CapturedPieces game={game} color="white" />
          <CardHand
            game={game}
            color={game.turn}
            side="own"
            casting={controller.casting}
            onSelect={controller.selectSpell}
            onCancel={controller.cancelSpell}
            playable={!gameOver}
          />
        </div>

        <aside className="layout__sidebar">
          <ClockPanel clock={clock} turn={game.turn} gameOver={controller.gameOver} />
          <StatusPanel game={game} />
          {game.phase === 'bonus' && !gameOver && (
            <div className="banner banner--bonus">
              <strong>
                {game.pawnOrder?.stage === 'active' ? '📯 Royal Order' : 'Free move'}
              </strong>
              <span>
                {game.pawnOrder?.stage === 'active'
                  ? 'One of your Pawns may make an extra move.'
                  : 'Your Duelist may take a free move.'}
              </span>
              <button type="button" className="button" onClick={passBonus}>
                Pass
              </button>
            </div>
          )}
          {gameOver && (
            <div className="banner">
              <strong>{status.headline}</strong>
              <span>{status.detail}</span>
            </div>
          )}
          <PieceInfo
            game={game}
            selected={controller.selected}
            moveCount={selectedMoves.length}
            captureCount={selectedCaptures}
          />
          <GameControls
            onNewGame={newGame}
            gameOver={gameOver}
            hasMoves={game.history.length > 0}
          />
          <MoveHistory history={game.history} />
        </aside>
      </main>

      <CardActivation activation={activation} />

      {pendingChoice && (
        <MoveChoiceDialog
          color={game.turn}
          options={pendingChoice.options}
          onChoose={chooseMove}
          onCancel={cancelChoice}
        />
      )}
    </div>
  );
}
