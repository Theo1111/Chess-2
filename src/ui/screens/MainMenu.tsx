import { DEFAULT_ROSTER_BUDGET } from '../../roster';

interface MainMenuProps {
  onClassic: () => void;
  onDraft: () => void;
}

export function MainMenu({ onClassic, onDraft }: MainMenuProps) {
  return (
    <div className="menu">
      <h1 className="menu__title">
        Chess<span className="app__title-mark">2</span>
      </h1>
      <p className="menu__tagline">Build your army. Take the board.</p>

      <div className="menu__options">
        <button type="button" className="menu__option" onClick={onDraft}>
          <span className="menu__option-name">Custom armies</span>
          <span className="menu__option-detail">
            Draft {DEFAULT_ROSTER_BUDGET} points of legends, pick your spells and traps,
            deploy them your way, and battle.
          </span>
        </button>
        <button type="button" className="menu__option" onClick={onClassic}>
          <span className="menu__option-name">Classic chess</span>
          <span className="menu__option-detail">The standard game, untouched.</span>
        </button>
      </div>
    </div>
  );
}
