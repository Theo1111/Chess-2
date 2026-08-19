import { GameScreen } from './ui/screens/GameScreen';
import { MainMenu } from './ui/screens/MainMenu';
import { MatchHistory } from './ui/screens/MatchHistory';
import { OnlineScreen } from './ui/screens/OnlineScreen';
import { PlacementScreen } from './ui/screens/PlacementScreen';
import { TeamBuilder } from './ui/screens/TeamBuilder';
import { useAppFlow } from './ui/useAppFlow';
import { useAccount } from './cloud/useAccount';

/**
 * Screen router. All flow logic lives in `useAppFlow`; all game logic lives in
 * the engine and roster layers. This component only chooses what to render.
 */
export default function App() {
  const flow = useAppFlow();
  const account = useAccount();
  const { screen, draft } = flow;

  const menu = (
    <MainMenu
      onClassic={flow.startClassic}
      onDraft={flow.startDraft}
      onOnline={flow.toOnline}
      timeControl={flow.timeControl}
      onTimeControl={flow.setTimeControl}
      account={account}
      onShowHistory={flow.toHistory}
    />
  );

  switch (screen.kind) {
    case 'menu':
      return menu;

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
      return (
        <GameScreen
          mode={screen.mode}
          draft={draft}
          timeControl={flow.timeControl}
          user={account.user}
          onExit={flow.toMenu}
        />
      );

    case 'history':
      // Signing out while on the history screen falls back to the menu.
      return account.user ? <MatchHistory user={account.user} onBack={flow.toMenu} /> : menu;

    case 'online':
      // Online play requires a signed-in account; signing out mid-screen
      // falls back to the menu rather than stranding a headless lobby.
      return account.user ? (
        <OnlineScreen user={account.user} timeControl={flow.timeControl} onExit={flow.toMenu} />
      ) : (
        menu
      );
  }
}
