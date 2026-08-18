import { useCallback } from 'react';
import { createInitialState, type GameState } from '../../engine';
import { createGameFromRosters } from '../../roster';
import type { DraftState } from '../useAppFlow';
import { Board } from '../components/Board';
import { CapturedPieces } from '../components/CapturedPieces';
import { GameControls } from '../components/GameControls';
import { MoveChoiceDialog } from '../components/MoveChoiceDialog';
import { MoveHistory } from '../components/MoveHistory';
import { PieceInfo } from '../components/PieceInfo';
import { SpellBar } from '../components/SpellBar';
import { StatusPanel, describeStatus } from '../components/StatusPanel';
import { useChessGame } from '../useChessGame';

interface GameScreenProps {
  mode: 'classic' | 'custom';
  draft: DraftState;
  onExit: () => void;
}

export function GameScreen({ mode, draft, onExit }: GameScreenProps) {
  const createGame = useCallback(
    (): GameState =>
      mode === 'custom' ? createGameFromRosters(draft.white, draft.black) : createInitialState(),
    [mode, draft],
  );

  const controller = useChessGame(createGame);
  const { game, gameOver, pendingChoice, chooseMove, cancelChoice, passBonus, newGame } = controller;
  const status = describeStatus(game);

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
            {mode === 'custom' ? 'Custom armies' : 'Classic chess'} — two players, one board
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onExit}>
          Menu
        </button>
      </header>

      <main className="layout">
        <div className="layout__board">
          <CapturedPieces game={game} color="black" />
          <Board controller={controller} />
          <CapturedPieces game={game} color="white" />
        </div>

        <aside className="layout__sidebar">
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
          <SpellBar
            game={game}
            casting={controller.casting}
            onSelect={controller.selectSpell}
            onCancel={controller.cancelSpell}
          />
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
