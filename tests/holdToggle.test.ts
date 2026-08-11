import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '../src/core/InputManager';
import { DEFAULT_BINDINGS } from '../src/core/Keybindings';

/**
 * Hold, or press twice.
 *
 * Holding a mouse button or a shoulder trigger for a sustained stretch is
 * exactly the demand some players cannot meet, and removing it changes
 * nothing about how the game plays. Hold stays the default because it is what
 * the game was built around.
 *
 * The failure worth catching is a latch that survives something it should
 * not: a mode switch, or a lost window focus. Either leaves a player
 * permanently aiming with no memory of having asked for it, which is the
 * toggle-mode version of a stuck key.
 */

let input: InputManager;

const key = (code: string, type: 'keydown' | 'keyup' = 'keydown') =>
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

/**
 * A full right-click: down *and* up.
 *
 * The release matters. An earlier version of this file only sent
 * `pointerdown`, then switched to hold mode and expected aim to drop — but in
 * hold mode a button that was never released is genuinely still held, so the
 * code was right and the test was modelling a player whose finger never came
 * off the mouse.
 */
const rightMouseDown = () =>
  document
    .getElementById('surface')!
    .dispatchEvent(new PointerEvent('pointerdown', { button: 2, pointerId: 1, bubbles: true }));

const rightMouseUp = () =>
  window.dispatchEvent(new PointerEvent('pointerup', { button: 2, pointerId: 1, bubbles: true }));

const rightMouse = () => {
  rightMouseDown();
  rightMouseUp();
};

beforeEach(() => {
  document.body.innerHTML = '<div id="surface"></div>';
  input = new InputManager();
  input.attach(document.getElementById('surface') as HTMLElement);
});

describe('hold is the default', () => {
  it('runs while the key is down and stops when it is up', () => {
    key(DEFAULT_BINDINGS.run);
    expect(input.running).toBe(true);
    key(DEFAULT_BINDINGS.run, 'keyup');
    expect(input.running).toBe(false);
  });

  it('aims while the button is down, and stops when it is up', () => {
    rightMouseDown();
    expect(input.aimHeld).toBe(true);
    rightMouseUp();
    expect(input.aimHeld).toBe(false);
  });
});

describe('toggle', () => {
  beforeEach(() => input.setHoldModes(false, false));

  it('starts running on a press and keeps running after the release', () => {
    key(DEFAULT_BINDINGS.run);
    key(DEFAULT_BINDINGS.run, 'keyup');
    expect(input.running, 'the release stopped it').toBe(true);
  });

  it('is unaffected by a key that is merely still held', () => {
    // In hold mode a key still down means still running, and that is correct.
    // The latch is about what happens *after* the release.
    input.setHoldModes(true, true);
    key(DEFAULT_BINDINGS.run);
    expect(input.running).toBe(true);
  });

  it('stops on the second press', () => {
    key(DEFAULT_BINDINGS.run);
    key(DEFAULT_BINDINGS.run, 'keyup');
    key(DEFAULT_BINDINGS.run);
    expect(input.running).toBe(false);
  });

  it('latches aim on a click and releases it on the next one', () => {
    rightMouse();
    expect(input.aimHeld).toBe(true);
    rightMouse();
    expect(input.aimHeld).toBe(false);
  });

  it('follows a rebound run key, not the default one', () => {
    // The latch is flipped from the resolved action, so remapping and toggle
    // compose rather than each assuming the other is off.
    const kb = input.keybindings;
    kb.rebind('run', 'KeyB');
    input.setBindings(kb);
    key('KeyB');
    expect(input.running).toBe(true);
  });
});

describe('a latch never outlives its reason', () => {
  it('drops when the mode is switched back to hold', () => {
    input.setHoldModes(false, false);
    key(DEFAULT_BINDINGS.run);
    key(DEFAULT_BINDINGS.run, 'keyup');
    expect(input.running, 'the latch did not hold past the release').toBe(true);

    // Somebody turning toggle off while running must not be left running with
    // nothing holding the key down and no way to stop.
    input.setHoldModes(true, true);
    expect(input.running).toBe(false);
  });

  it('drops the aim latch on a mode switch too', () => {
    input.setHoldModes(false, false);
    rightMouse();
    expect(input.aimHeld).toBe(true);
    input.setHoldModes(true, true);
    expect(input.aimHeld).toBe(false);
  });

  it('drops on lost focus, like every other held state', () => {
    input.setHoldModes(false, false);
    key(DEFAULT_BINDINGS.run);
    key(DEFAULT_BINDINGS.run, 'keyup');
    rightMouse();
    expect(input.running && input.aimHeld).toBe(true);

    input.releaseAll();
    expect(input.running, 'came back from a hidden tab still running').toBe(false);
    expect(input.aimHeld, 'came back from a hidden tab still aiming').toBe(false);
  });

  it('leaves the other mode alone when only one is switched', () => {
    input.setHoldModes(false, false);
    key(DEFAULT_BINDINGS.run);
    key(DEFAULT_BINDINGS.run, 'keyup');
    rightMouse();

    // Aim back to hold; run stays on toggle and keeps its latch.
    input.setHoldModes(true, false);
    expect(input.aimHeld).toBe(false);
    expect(input.running, 'the run latch was dropped for no reason').toBe(true);
  });
});

describe('the synthetic aim path still works in either mode', () => {
  it('holds through the bridge regardless of mode', () => {
    // `setAimHeld` is how the test bridge presses aim. It has to work in
    // toggle mode too, or every combat browser test would depend on a setting.
    for (const hold of [true, false]) {
      input.setHoldModes(hold, hold);
      input.setAimHeld(true);
      expect(input.aimHeld, `synthetic aim ignored with hold=${hold}`).toBe(true);
      input.setAimHeld(false);
      expect(input.aimHeld).toBe(false);
    }
  });
});
