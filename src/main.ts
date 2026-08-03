import './style.css';
import { Game } from './core/Game';
import { LoadingScreen } from './ui/LoadingScreen';

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
  const loading = new LoadingScreen(() => game?.begin());

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

  if (import.meta.hot) {
    import.meta.hot.dispose(() => game?.dispose());
  }
}

void boot();
