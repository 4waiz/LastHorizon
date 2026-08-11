import './style.css';
import { Game } from './core/Game';
import { LoadingScreen } from './ui/LoadingScreen';
import { featureFlags } from './core/FeatureFlags';
import { installCrashHandler } from './core/Recovery';

/** Entry point: boot the game behind the loading screen, fail visibly. */

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGL2RenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('missing #viewport canvas');

  let game: Game | null = null;

  // Before anything can throw. `boot()`'s own failures are reported by the
  // loading screen, which is the better message while there is still a
  // loading screen to show; this covers the hours after it goes away, where
  // until now an unhandled error left the canvas frozen on its last frame
  // with nothing to tell the player it had stopped.
  //
  // The snapshot is a closure over `game` rather than a value, so it reports
  // whatever is true at the moment of the crash and works fine when the
  // answer is "the game had not finished starting".
  installCrashHandler({
    snapshot: () => game?.diagnostics() ?? { started: false },
  });
  const loading = new LoadingScreen((mode, options) => game?.begin(mode, options));

  if (!hasWebGL()) {
    loading.fail('This browser cannot run WebGL.');
    return;
  }

  game = new Game(canvas);
  try {
    await game.start(loading);
  } catch (err) {
    console.error('[LastHorizon] failed to start', err);
    loading.fail('Something went wrong loading the world.');
    return;
  }

  if (import.meta.env.DEV) {
    // Handle for manual inspection and deterministic frame capture.
    (window as unknown as { __lh: unknown }).__lh = game;
  }

  // Deterministic test bridge. Opt-in via ?e2e=1 only — a normal visit, in dev
  // or production, never installs it.
  if (featureFlags().e2e) {
    const { installTestBridge } = await import('./core/TestMode');
    installTestBridge(game.testSurface());
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => game?.dispose());
  }
}

void boot();
