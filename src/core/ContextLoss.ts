/**
 * WebGL context loss, and the honest response to it.
 *
 * A lost context is not rare and not a bug: a driver reset, a laptop switching
 * GPUs, a phone reclaiming memory under pressure, or too many live contexts in
 * one browser will all take it away. Until now the game did nothing at all,
 * which means the canvas froze on its last frame with no explanation — the
 * same worst-case failure the crash screen was added for, arriving by a
 * different route.
 *
 * ## Why this offers a reload rather than resuming
 *
 * Every GPU-side object dies with the context: textures, geometries, programs,
 * and — the ones that matter here — the render targets behind post-processing
 * and `WindowPortal`. three.js re-uploads much of that lazily on the next
 * render, so a small scene often does survive `webglcontextrestored`.
 *
 * This scene is not small, and two things in it are not covered by that:
 *
 * 1. **The half-resolution portal target**, rebuilt only when the interior is
 *    entered. A restore mid-session leaves the two hero interiors rendering
 *    from a dead target.
 * 2. **~54 shader programs built from `onBeforeCompile` patches.** They do
 *    recompile, but the first frame after a restore pays for all of them at
 *    once, on a machine that has just had a driver reset.
 *
 * So a silent resume would work most of the time and produce a subtly wrong
 * world the rest of it, which is worse than a clear message: a player who is
 * told what happened reloads in two seconds and loses nothing, because the
 * game autosaves. Claiming recovery we have not verified is exactly what the
 * phase reports in this repository keep warning about.
 *
 * `preventDefault()` on the loss event is still correct and still required —
 * without it the browser will never fire `webglcontextrestored` at all, so the
 * "restored" branch could not report anything even to say the context came
 * back.
 */

export interface ContextLossHooks {
  /** Stop the frame loop and anything else that would keep touching GL. */
  readonly onLost: () => void;
  /** The context came back. Used to change the panel's wording, not to resume. */
  readonly onRestored: () => void;
}

const $ = (id: string): HTMLElement | null => document.getElementById(id);

let bound: HTMLCanvasElement | null = null;
let lost = false;

/** Test-facing: whether a loss has been observed this session. */
export function contextLost(): boolean {
  return lost;
}

/** Test-only. */
export function resetContextLossForTest(): void {
  lost = false;
  bound = null;
  const panel = $('crash');
  if (panel) panel.hidden = true;
}

function raisePanel(restored: boolean): void {
  const panel = $('crash');
  const title = $('crashTitle');
  const lede = document.querySelector<HTMLElement>('.crash__lede');
  const detail = $('crashDetail');
  const save = $('crashSave');
  const reload = $('crashReload') as HTMLButtonElement | null;

  if (title) title.textContent = 'The graphics card dropped the game';
  if (lede) {
    lede.textContent = restored
      ? 'Your browser released the 3D view and has since restored it. Reload to carry on — your progress is saved up to the last autosave.'
      : 'Your browser released the 3D view. This usually means a graphics driver reset, a switch between graphics chips, or another tab needing the memory.';
  }
  if (detail) detail.textContent = '';
  // The diagnostic bundle is about an *exception*; there is no stack here and
  // offering the button would produce a file that says nothing useful.
  if (save) save.hidden = true;
  if (reload) reload.textContent = 'Reload the game';
  if (panel) panel.hidden = false;
}

/**
 * Bind to a canvas. Idempotent per canvas, so a renderer rebuild cannot stack
 * two sets of listeners on the same element.
 */
export function installContextLossHandler(
  canvas: HTMLCanvasElement,
  hooks: ContextLossHooks,
): void {
  if (bound === canvas) return;
  bound = canvas;

  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      // Without this the browser treats the loss as permanent and never fires
      // `webglcontextrestored`.
      e.preventDefault();
      if (lost) return;
      lost = true;
      console.warn('[LastHorizon] WebGL context lost');
      try {
        hooks.onLost();
      } finally {
        raisePanel(false);
      }
    },
    false,
  );

  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      console.warn('[LastHorizon] WebGL context restored; reload to resume');
      hooks.onRestored();
      raisePanel(true);
    },
    false,
  );
}
