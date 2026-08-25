import { useCallback, useEffect, useMemo, useState } from 'react';
import { createInitialState, getSpellDefinition, opposite } from '../../engine';
import type { AccountUser } from '../../cloud/auth';
import {
  cancelMatchmaking,
  findOnlineMatch,
  myActiveOnlineGame,
} from '../../cloud/online';
import { useOnlineGame } from '../../cloud/useOnlineGame';
import { useOnlineController } from '../../cloud/useOnlineController';
import {
  DEFAULT_TIME_CONTROL,
  TIME_CONTROLS,
  getTimeControl,
  type TimeControlId,
} from '../timeControls';
import { Board, frozenBoard } from '../components/Board';
import { CardActivation } from '../components/CardActivation';
import { CardChoiceDialog } from '../components/CardChoiceDialog';
import { CardHand } from '../components/CardHand';
import { CapturedPieces } from '../components/CapturedPieces';
import { ClockPanel } from '../components/ClockPanel';
import { MoveChoiceDialog } from '../components/MoveChoiceDialog';
import { MoveHistory } from '../components/MoveHistory';
import { useCardActivations } from '../useCardActivations';
import { OnlineDraft } from './OnlineDraft';

interface OnlineScreenProps {
  user: AccountUser;
  onExit: () => void;
}

/**
 * Online play: find an opponent, then play the shared game.
 *
 * Every match is a custom-army game: players choose a time control, are
 * paired with someone who chose the same one, then each drafts an army
 * before the board appears. While queued we poll `my_active_online_game` —
 * the moment someone else's `find_online_match` pairs us, the game id
 * appears and both screens flip to the board.
 *
 * The clock lives here rather than on the menu because it is a rule two
 * strangers agree to; a hot-seat game shares a room and a wall clock.
 */
export function OnlineScreen({ user, onExit }: OnlineScreenProps) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [timeControl, setTimeControl] = useState<TimeControlId>(DEFAULT_TIME_CONTROL);

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
              <p className="online-lobby__status">Play a ranked-free game against a real opponent.</p>

              <section className="online-lobby__timing" aria-label="Time control">
                <h2 className="online-lobby__timing-title">Time per player</h2>
                <div
                  className="online-lobby__timing-options"
                  role="radiogroup"
                  aria-label="Time per player"
                >
                  {TIME_CONTROLS.map((control) => (
                    <button
                      key={control.id}
                      type="button"
                      role="radio"
                      aria-checked={timeControl === control.id}
                      className={`timechip${timeControl === control.id ? ' timechip--active' : ''}`}
                      onClick={() => setTimeControl(control.id)}
                    >
                      {control.label}
                    </button>
                  ))}
                </div>
              </section>

              <p className="online-lobby__hint">
                Signed in as <strong>{user.displayName}</strong>. You are matched with the next
                player searching on the same time control, then you each get 60 seconds to
                draft an army.
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
  const {
    row,
    replay,
    myColor,
    canAct,
    submit,
    resign,
    error,
    clock,
    draftSecondsLeft,
    armySubmitted,
    submitArmy,
  } = online;

  // Hooks must run unconditionally; while the row loads (and during the
  // draft, before either army exists) the controller gets a plain starting
  // position it can never act on, because canAct is false.
  const fallback = useMemo(() => createInitialState(), []);
  const shown = replay?.state ?? fallback;
  const controller = useOnlineController(shown, myColor, canAct, (action) => void submit(action));
  const activation = useCardActivations(shown);
  const strike = activation?.spell === 'rulers-authority' ? activation : null;

  if (!row) {
    return (
      <div className="app">
        <p className="online-lobby__status">Loading game…</p>
      </div>
    );
  }

  // Draft first: the board does not exist until both armies do.
  if (row.status === 'drafting' && myColor) {
    return (
      <OnlineDraft
        color={myColor}
        secondsLeft={draftSecondsLeft}
        submitted={armySubmitted}
        opponentName={myColor === 'white' ? row.black_name : row.white_name}
        onSubmit={(roster) => void submitArmy(roster)}
        onLeave={onExit}
      />
    );
  }

  if (row.status === 'cancelled') {
    return (
      <div className="app online-lobby">
        <div className="panel online-lobby__panel">
          <h2 className="panel__title">Match cancelled</h2>
          <p className="online-lobby__status">
            {row.reason === 'draft timed out'
              ? 'One of you ran out of drafting time.'
              : (row.reason ?? 'The match was cancelled.')}
          </p>
          <button type="button" className="button button--primary" onClick={onExit}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  if (!replay) {
    return (
      <div className="app">
        <p className="online-lobby__status">Waiting for both armies…</p>
      </div>
    );
  }

  const opponentName = myColor === 'white' ? row.black_name : row.white_name;
  // Spectators (no colour of their own) watch from White's side of the table.
  const viewer = myColor ?? 'white';
  const finished = row.status === 'finished';
  const desynced = !replay.valid;

  const headline = desynced
    ? 'Game voided'
    : finished
      ? row.winner === 'draw'
        ? 'Draw'
        : `${row.winner === 'white' ? row.white_name : row.black_name} wins${
            row.reason === 'timeout' ? ' on time' : ''
          }`
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
            {clock.enabled && ` · ${getTimeControl(row.time_control as TimeControlId).label} each`}
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onExit}>
          Menu
        </button>
      </header>

      <main className="layout">
        <div className="layout__board">
          {/* Your own cards lie face up along your edge of the board; the
              opponent's are backs until the game itself turns one over. */}
          <CardHand game={replay.state} color={opposite(viewer)} side="opponent" />
          <CapturedPieces game={replay.state} color="black" />
          <Board
            controller={strike ? frozenBoard(strike.before) : controller}
            orientation={viewer}
            annihilating={strike?.color ?? null}
          />
          <CapturedPieces game={replay.state} color="white" />
          <CardHand
            game={replay.state}
            color={viewer}
            side={myColor ? 'own' : 'opponent'}
            casting={controller.casting}
            onSelect={controller.selectSpell}
            onCancel={controller.cancelSpell}
            playable={canAct}
          />
        </div>

        <aside className="layout__sidebar">
          <ClockPanel clock={clock} turn={replay.state.turn} gameOver={finished || desynced} />
          <div className={`panel status${canAct ? ' status--your-turn' : ''}`}>
            <strong>{headline}</strong>
            <span>{detail}</span>
          </div>
          {error && <p className="account__error">{error}</p>}
          {canAct && replay.state.phase === 'bonus' && (
            <div className="banner banner--bonus">
              <strong>
                {replay.state.pawnOrder?.stage === 'active' ? '📯 Royal Order' : 'Free move'}
              </strong>
              <span>
                {replay.state.pawnOrder?.stage === 'active'
                  ? 'One of your Pawns may make an extra move.'
                  : 'Your Duelist may take a free move.'}
              </span>
              <button type="button" className="button" onClick={controller.passBonus}>
                Pass
              </button>
            </div>
          )}
          {!finished && !desynced && myColor && (
            <button type="button" className="button" onClick={() => void resign()}>
              Resign
            </button>
          )}
          <MoveHistory history={replay.state.history} />
        </aside>
      </main>

      <CardActivation activation={activation} />

      {controller.cardChoice && (
        <CardChoiceDialog
          card={getSpellDefinition(controller.cardChoice.spell).name}
          color={opposite(viewer)}
          options={controller.cardChoice.options}
          onChoose={controller.chooseCard}
          onCancel={controller.cancelSpell}
        />
      )}

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
