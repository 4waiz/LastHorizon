import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { crashState, installCrashHandler, resetCrashForTest } from '../src/core/Recovery';
import {
  contextLost,
  installContextLossHandler,
  resetContextLossForTest,
} from '../src/core/ContextLoss';

/**
 * The two screens that exist for the moment everything else has stopped
 * working, so both are tested for the properties that make them useful *then*
 * rather than for their happy path:
 *
 * - the first error wins, because a broken frame loop throws every frame;
 * - a failing diagnostics callback does not become a second crash;
 * - an asset `error` event is not a crash, because the audio layer already
 *   degrades to synthesis when its files are missing and putting a modal over
 *   that would be a regression.
 */

/** The static markup from index.html that both screens raise. */
function mountCrashMarkup(): void {
  document.body.innerHTML = `
    <div id="crash" class="crash" hidden>
      <div class="crash__card">
        <h2 id="crashTitle">The game stopped</h2>
        <p class="crash__lede">lede</p>
        <p class="crash__detail" id="crashDetail"></p>
        <button id="crashReload"></button>
        <button id="crashSave"></button>
      </div>
    </div>`;
}

const panel = (): HTMLElement => document.getElementById('crash')!;

describe('Recovery', () => {
  beforeEach(() => {
    mountCrashMarkup();
    resetCrashForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays out of the way until something breaks', () => {
    installCrashHandler(null);
    expect(panel().hidden).toBe(true);
    expect(crashState().crashed).toBe(false);
  });

  it('raises the panel on an unhandled error and names it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installCrashHandler(null);

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('cannot read spawn of null') }),
    );

    expect(panel().hidden).toBe(false);
    expect(crashState().message).toBe('cannot read spawn of null');
    // `textContent`, never innerHTML — an exception message is untrusted.
    expect(document.getElementById('crashDetail')!.textContent).toContain('cannot read spawn');
  });

  it('keeps the first error and counts the rest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installCrashHandler(null);

    // A broken frame loop throws sixty times a second. The first is the only
    // one that says anything; the rest would bury it.
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('first') }));
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error(`later ${i}`) }));
    }

    expect(crashState().message).toBe('first');
    expect(crashState().suppressed).toBe(5);
  });

  it('ignores a failed asset load, which is not a crash', () => {
    installCrashHandler(null);

    // An <audio> that 404s bubbles an `error` event with a target. The audio
    // layer already degrades to synthesis; a modal over that is a regression.
    const audio = document.createElement('audio');
    document.body.append(audio);
    const e = new Event('error');
    Object.defineProperty(e, 'target', { value: audio });
    window.dispatchEvent(e);

    expect(crashState().crashed).toBe(false);
    expect(panel().hidden).toBe(true);
  });

  it('does not turn a broken diagnostics callback into a second crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installCrashHandler({
      snapshot: () => {
        throw new Error('the game state is the thing that broke');
      },
    });

    // Raising the panel must not throw even when the host cannot describe
    // itself, which is exactly the likely case after an unhandled exception.
    expect(() =>
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom') })),
    ).not.toThrow();
    expect(crashState().message).toBe('boom');
  });

  it('installs once however many times it is called', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installCrashHandler(null);
    installCrashHandler(null);
    installCrashHandler(null);

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once') }));
    // Two registrations would record the same error twice and report one of
    // them as suppressed.
    expect(crashState().suppressed).toBe(0);
  });
});

describe('ContextLoss', () => {
  beforeEach(() => {
    mountCrashMarkup();
    resetContextLossForTest();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops the loop and explains, rather than freezing on the last frame', () => {
    const canvas = document.createElement('canvas');
    let stopped = false;
    installContextLossHandler(canvas, {
      onLost: () => {
        stopped = true;
      },
      onRestored: () => {},
    });

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(stopped).toBe(true);
    expect(contextLost()).toBe(true);
    expect(panel().hidden).toBe(false);
    expect(document.getElementById('crashTitle')!.textContent).toMatch(/graphics/i);
  });

  it('cancels the loss event, or the browser never offers a restore', () => {
    const canvas = document.createElement('canvas');
    installContextLossHandler(canvas, { onLost: () => {}, onRestored: () => {} });

    const e = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(e);

    // This is the whole reason `preventDefault` is there: without it
    // `webglcontextrestored` never fires at all.
    expect(e.defaultPrevented).toBe(true);
  });

  it('hides the diagnostics button, which would describe an exception that never happened', () => {
    const canvas = document.createElement('canvas');
    installContextLossHandler(canvas, { onLost: () => {}, onRestored: () => {} });
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect((document.getElementById('crashSave') as HTMLElement).hidden).toBe(true);
  });

  it('reports a restore without claiming the game resumed', () => {
    const canvas = document.createElement('canvas');
    let restored = false;
    installContextLossHandler(canvas, {
      onLost: () => {},
      onRestored: () => {
        restored = true;
      },
    });

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(restored).toBe(true);
    // Still asking for a reload: resuming would leave the portal render target
    // and ~54 patched programs in a state nothing has verified.
    expect(document.querySelector('.crash__lede')!.textContent).toMatch(/[Rr]eload/);
  });

  it('reports the loss once, not once per frame', () => {
    const canvas = document.createElement('canvas');
    let calls = 0;
    installContextLossHandler(canvas, {
      onLost: () => {
        calls++;
      },
      onRestored: () => {},
    });

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));

    expect(calls).toBe(1);
  });
});
