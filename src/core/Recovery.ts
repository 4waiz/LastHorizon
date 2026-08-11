/**
 * The screen a player sees when something has genuinely gone wrong.
 *
 * Until now an unhandled error after boot left the canvas frozen on its last
 * frame with no explanation — the loading screen's `fail()` covers the boot
 * path and nothing covered the other several hours. A frozen picture is the
 * worst possible failure mode, because it is indistinguishable from a very
 * long stall, so the player waits instead of reloading.
 *
 * Three deliberate choices:
 *
 * **It reports, it does not phone home.** The diagnostic bundle is built in
 * memory and downloaded to the player's own device through a blob URL. There
 * is no endpoint, no key, and no consent question to get wrong — the same
 * argument the Life Reel makes for exporting locally, and the reason
 * `story.spec.ts` can assert nothing but a GET ever leaves the page.
 *
 * **It fires once.** A broken frame loop throws every frame; a handler that
 * re-rendered each time would bury the first error, which is the only one that
 * is any use, under thousands of identical later ones. The first error wins
 * and the rest are counted.
 *
 * **It does not try to keep playing.** Offering "continue" after an unknown
 * exception is offering a state nobody has reasoned about, and this game
 * autosaves — the honest options are reload and, if the player wants it, the
 * file that says what happened.
 */

export interface Diagnostics {
  /** Whatever the game can say about itself. Must never throw. */
  readonly snapshot: () => Record<string, unknown>;
}

interface CrashRecord {
  message: string;
  stack: string;
  kind: 'error' | 'rejection';
  at: string;
}

const MAX_STACK = 4000;

let installed = false;
let firstCrash: CrashRecord | null = null;
let suppressed = 0;

/**
 * Held so `resetCrashForTest` can genuinely detach them.
 *
 * Clearing `installed` without removing the listeners left every previous
 * test's handler attached, so a single dispatched error was recorded once and
 * then "suppressed" by each stale listener — the suppression count came back
 * as 17 rather than 5. A reset that leaves the thing it reset still running is
 * not a reset.
 */
let onError: ((e: ErrorEvent) => void) | null = null;
let onRejection: ((e: PromiseRejectionEvent) => void) | null = null;

const $ = (id: string): HTMLElement | null => document.getElementById(id);

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return {
      message: err.message || err.name || 'Unknown error',
      stack: (err.stack ?? '').slice(0, MAX_STACK),
    };
  }
  // A rejection can carry anything, including a DOM event or a bare string.
  try {
    return { message: String(err).slice(0, 500), stack: '' };
  } catch {
    return { message: 'Unknown error', stack: '' };
  }
}

/**
 * Build the bundle. Everything here is either constant, or already visible to
 * the player, or something they typed — no identifiers, no storage contents,
 * no save data. It is meant to be readable before it is sent to anybody.
 */
function buildReport(diag: Diagnostics | null): string {
  let snapshot: Record<string, unknown>;
  try {
    snapshot = diag?.snapshot() ?? {};
  } catch (err) {
    // `Game.diagnostics` already guards itself, so reaching here means the
    // host handed us something that throws on call. Report that rather than
    // losing the crash we came to record.
    snapshot = { snapshotFailed: describe(err).message };
  }

  const report = {
    game: 'Last Horizon',
    version: __LH_VERSION__,
    built: __LH_BUILD__,
    crash: firstCrash,
    suppressedAfterFirst: suppressed,
    page: {
      // `location.href` can carry query flags the player used, which is
      // exactly the thing worth knowing. It carries nothing else: this game
      // has no accounts and puts nothing personal in a URL.
      url: location.href,
      referrerPresent: document.referrer !== '',
    },
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      deviceMemoryGB: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      touchPoints: navigator.maxTouchPoints ?? 0,
      online: navigator.onLine,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    game_state: snapshot,
  };

  return JSON.stringify(report, null, 2);
}

function show(diag: Diagnostics | null): void {
  const panel = $('crash');
  if (!panel) return;

  const detail = $('crashDetail');
  if (detail && firstCrash) {
    // `textContent`, never innerHTML: the message is an exception string and
    // an exception string can contain anything at all.
    detail.textContent = `${firstCrash.message}`;
  }

  const save = $('crashSave') as HTMLButtonElement | null;
  if (save) {
    save.onclick = () => {
      const blob = new Blob([buildReport(diag)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `last-horizon-diagnostics-${Date.now()}.json`;
      a.click();
      // Revoking immediately races the download in some browsers; a frame is
      // enough and the object is a few kB either way.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
    };
  }

  const reload = $('crashReload') as HTMLButtonElement | null;
  if (reload) reload.onclick = () => location.reload();

  panel.hidden = false;
}

function record(err: unknown, kind: CrashRecord['kind'], diag: Diagnostics | null): void {
  if (firstCrash) {
    suppressed++;
    return;
  }
  const { message, stack } = describe(err);
  firstCrash = { message, stack, kind, at: new Date().toISOString() };
  // Keep it in the console too. A developer with the tab open should not have
  // to download a file to see what a player's browser just did.
  console.error('[LastHorizon] unrecoverable error', err);
  show(diag);
}

/**
 * Install the handlers. Idempotent, and safe to call before the game exists —
 * `diag` is consulted only when something has already gone wrong.
 */
export function installCrashHandler(diag: Diagnostics | null = null): void {
  if (installed) return;
  installed = true;

  onError = (e) => {
    // A failed `<img>` or `<audio>` fires this too, and is not a crash — the
    // audio layer already degrades to synthesis when its files are missing,
    // and a modal over that would be a regression.
    //
    // Discriminated on the target being an *element* rather than on it being
    // `window`. The obvious `e.target !== window` test looks right and is
    // wrong twice: jsdom's window dispatch does not set `target` to the same
    // object the test file calls `window`, so the guard swallowed every
    // synthetic error and three tests failed on an empty message; and in a
    // real browser a resource error is only ever an element. Asking the
    // question the other way round is true in both.
    if (e.target instanceof Element) return;
    record(e.error ?? e.message, 'error', diag);
  };

  onRejection = (e) => {
    record(e.reason, 'rejection', diag);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
}

/** Test-facing: whether the screen has been raised, and what raised it. */
export function crashState(): { crashed: boolean; message: string; suppressed: number } {
  return {
    crashed: firstCrash !== null,
    message: firstCrash?.message ?? '',
    suppressed,
  };
}

/** Test-only: forget the crash so a suite can raise another. */
export function resetCrashForTest(): void {
  if (onError) window.removeEventListener('error', onError);
  if (onRejection) window.removeEventListener('unhandledrejection', onRejection);
  onError = null;
  onRejection = null;
  firstCrash = null;
  suppressed = 0;
  installed = false;
  const panel = $('crash');
  if (panel) panel.hidden = true;
}
