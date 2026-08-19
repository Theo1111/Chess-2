import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountUser } from '../../cloud/auth';
import {
  cancelMatchmaking,
  findOnlineMatch,
  myActiveOnlineGame,
} from '../../cloud/online';
import { createOnlineInitialState } from '../../cloud/onlineReplay';
import { useOnlineGame } from '../../cloud/useOnlineGame';
import { useOnlineController } from '../../cloud/useOnlineController';
import { getTimeControl, type TimeControlId } from '../timeControls';
import { Board } from '../components/Board';
import { CapturedPieces } from '../components/CapturedPieces';
import { MoveChoiceDialog } from '../components/MoveChoiceDialog';
import { MoveHistory } from '../components/MoveHistory';

interface OnlineScreenProps {
  user: AccountUser;
  timeControl: TimeControlId;
  onExit: () => void;
}

/**
 * Online play: find an opponent, then play the shared game.
 *
 * Matching pairs players on the same time-control choice. While queued we
 * poll `my_active_online_game` — the moment someone else's `find_online_match`
 * pairs us, the game id appears and both screens flip to the board.
 */
export function OnlineScreen({ user, timeControl, onExit }: OnlineScreenProps) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);

  const enterQueue = useCallback(async () => {
    setLobbyError(null);
    const result = await findOnlineMatch(timeControl, user.displayName);
    if (result.error) {
      setLobbyError(result.error);
      return;
    }
    if (result.gameId) setGameId(result.gameId);
    else setQueued(true);
  }, [timeControl, user.displayName]);

  // Queued: watch for the pairing another player creates.
  useEffect(() => {
    if (!queued || gameId) return;
    const poll = window.setInterval(() => {
      void myActiveOnlineGame().then((result) => {
        if (result.gameId) {
          setQueued(false);
          setGameId(result.gameId);
        }
      });
    }, 2000);
    return () => window.clearInterval(poll);
  }, [queued, gameId]);

  const leave = useCallback(() => {
    if (queued) void cancelMatchmaking();
    onExit();
  }, [queued, onExit]);

  if (!gameId) {
    return (
      <div className="app online-lobby">
        <header className="app__header app__header--row">
          <div>
            <h1 className="app__title">
              Chess<span className="app__title-mark">2</span>
            </h1>
            <p className="app__tagline">Online play — {getTimeControl(timeControl).label}</p>
          </div>
          <button type="button" className="button button--ghost" onClick={leave}>
            Menu
          </button>
        </header>

        <div className="panel online-lobby__panel">
          {queued ? (
            <>
              <p className="online-lobby__status">
                <span className="online-lobby__pulse" aria-hidden="true" />
                Waiting for an opponent…
              </p>
              <p className="online-lobby__hint">
                You will be paired with the next player who searches on{' '}
                {getTimeControl(timeControl).label}.
              </p>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void cancelMatchmaking();
                  setQueued(false);
                }}
              >
                Cancel search
              </button>
            </>
          ) : (
            <>
              <p className="online-lobby__status">Classic chess, online.</p>
              <p className="online-lobby__hint">
                Signed in as <strong>{user.displayName}</strong>. Time control comes from the
                menu setting; games are currently played unclocked.
              </p>
              <button type="button" className="button button--primary" onClick={() => void enterQueue()}>
                Find opponent
              </button>
              {lobbyError && <p className="account__error">{lobbyError}</p>}
            </>
          )}
        </div>
      </div>
    );
  }

  return <OnlineGameView gameId={gameId} user={user} onExit={onExit} />;
}

function OnlineGameView({
  gameId,
  user,
  onExit,
}: {
  gameId: string;
  user: AccountUser;
  onExit: () => void;
}) {
  const online = useOnlineGame(gameId, user);
  const { row, replay, myColor, canAct, submit, resign, error } = online;

  // Hooks must run unconditionally; while the row loads, the controller gets
  // the (inert) starting position and canAct is false.
  const fallback = useMemo(() => createOnlineInitialState(), []);
  const controller = useOnlineController(
    replay?.state ?? fallback,
    myColor,
    canAct,
    (action) => void submit(action),
  );

  if (!row || !replay) {
    return (
      <div className="app">
        <p className="online-lobby__status">Loading game…</p>
      </div>
    );
  }

  const opponentName = myColor === 'white' ? row.black_name : row.white_name;
  const finished = row.status === 'finished';
  const desynced = !replay.valid;

  const headline = desynced
    ? 'Game voided'
    : finished
      ? row.winner === 'draw'
        ? 'Draw'
        : `${row.winner === 'white' ? row.white_name : row.black_name} wins`
      : canAct
        ? 'Your move'
        : `Waiting for ${opponentName}…`;

  const detail = desynced
    ? `An illegal action was found at move ${replay.failedAt! + 1} — the players' game versions disagree.`
    : finished
      ? (row.reason ?? '')
      : `You are ${myColor ?? 'watching'} · vs ${opponentName}`;

  return (
    <div className="app">
      <header className="app__header app__header--row">
        <div>
          <h1 className="app__title">
            Chess<span className="app__title-mark">2</span>
          </h1>
          <p className="app__tagline">
            Online — {row.white_name} vs {row.black_name}
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onExit}>
          Menu
        </button>
      </header>

      <main className="layout">
        <div className="layout__board">
          <CapturedPieces game={replay.state} color="black" />
          <Board controller={controller} />
          <CapturedPieces game={replay.state} color="white" />
        </div>

        <aside className="layout__sidebar">
          <div className={`panel status${canAct ? ' status--your-turn' : ''}`}>
            <strong>{headline}</strong>
            <span>{detail}</span>
          </div>
          {error && <p className="account__error">{error}</p>}
          {!finished && !desynced && myColor && (
            <button type="button" className="button" onClick={() => void resign()}>
              Resign
            </button>
          )}
          <MoveHistory history={replay.state.history} />
        </aside>
      </main>

      {controller.pendingChoice && (
        <MoveChoiceDialog
          color={replay.state.turn}
          options={controller.pendingChoice.options}
          onChoose={controller.chooseMove}
          onCancel={controller.cancelChoice}
        />
      )}
    </div>
  );
}
