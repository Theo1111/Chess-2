import { GameScreen } from './ui/screens/GameScreen';
import { MainMenu } from './ui/screens/MainMenu';
import { PlacementScreen } from './ui/screens/PlacementScreen';
import { TeamBuilder } from './ui/screens/TeamBuilder';
import { useAppFlow } from './ui/useAppFlow';

/**
 * Screen router. All flow logic lives in `useAppFlow`; all game logic lives in
 * the engine and roster layers. This component only chooses what to render.
 */
export default function App() {
  const flow = useAppFlow();
  const { screen, draft } = flow;

  switch (screen.kind) {
    case 'menu':
      return <MainMenu onClassic={flow.startClassic} onDraft={flow.startDraft} />;

    case 'build':
      return (
        <TeamBuilder
          key={screen.color}
          color={screen.color}
          roster={draft[screen.color]}
          onChange={(roster) => flow.updateRoster(screen.color, roster)}
          onConfirm={() => flow.toPlacement(screen.color)}
          onBack={screen.color === 'white' ? flow.toMenu : () => flow.toPlacement('white')}
          onMirror={screen.color === 'black' ? flow.mirrorFromWhite : undefined}
        />
      );

    case 'place':
      return (
        <PlacementScreen
          key={screen.color}
          color={screen.color}
          roster={draft[screen.color]}
          onChange={(roster) => flow.updateRoster(screen.color, roster)}
          onConfirm={() => flow.finishPlacement(screen.color)}
          onBack={() => flow.backToBuild(screen.color)}
        />
      );

    case 'game':
      return <GameScreen mode={screen.mode} draft={draft} onExit={flow.toMenu} />;
  }
}
