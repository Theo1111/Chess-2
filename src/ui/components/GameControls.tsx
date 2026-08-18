interface GameControlsProps {
  onNewGame: () => void;
  gameOver: boolean;
  hasMoves: boolean;
}

export function GameControls({ onNewGame, gameOver, hasMoves }: GameControlsProps) {
  const confirmNeeded = hasMoves && !gameOver;

  return (
    <div className="controls">
      <button
        type="button"
        className={`button ${gameOver ? 'button--primary' : ''}`}
        onClick={() => {
          if (!confirmNeeded || window.confirm('Start a new game? The current game will be lost.')) {
            onNewGame();
          }
        }}
      >
        New game
      </button>
    </div>
  );
}
