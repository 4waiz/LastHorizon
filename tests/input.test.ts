import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../src/core/InputManager';

/** Dispatch a synthetic key event at the window, the way the browser does. */
function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true }));
}

describe('InputManager', () => {
  let input: InputManager;
  let element: HTMLElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    input = new InputManager();
    input.attach(element);
  });

  afterEach(() => {
    input.dispose();
    element.remove();
  });

  it('maps WASD to the movement axis', () => {
    key('keydown', 'KeyW');
    expect(input.move.y).toBeCloseTo(1, 6);
    key('keyup', 'KeyW');
    expect(input.move.y).toBe(0);

    key('keydown', 'KeyA');
    expect(input.move.x).toBeCloseTo(-1, 6);
    key('keyup', 'KeyA');
  });

  it('treats arrows as equivalent to WASD', () => {
    key('keydown', 'ArrowUp');
    expect(input.move.y).toBeCloseTo(1, 6);
    key('keyup', 'ArrowUp');
    key('keydown', 'ArrowRight');
    expect(input.move.x).toBeCloseTo(1, 6);
    key('keyup', 'ArrowRight');
  });

  it('normalises diagonals so they are not faster', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    const len = Math.hypot(input.move.x, input.move.y);
    expect(len).toBeCloseTo(1, 5);
    key('keyup', 'KeyW');
    key('keyup', 'KeyD');
  });

  it('cancels opposing keys', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyS');
    expect(input.move.y).toBeCloseTo(0, 6);
    key('keyup', 'KeyW');
    key('keyup', 'KeyS');
  });

  it('reports running only while shift is held', () => {
    expect(input.running).toBe(false);
    key('keydown', 'ShiftLeft');
    expect(input.running).toBe(true);
    key('keyup', 'ShiftLeft');
    expect(input.running).toBe(false);
  });

  it('consumes a jump exactly once', () => {
    key('keydown', 'Space');
    expect(input.consumeJump()).toBe(true);
    expect(input.consumeJump()).toBe(false);
  });

  it('ignores auto-repeat so holding space is one jump', () => {
    key('keydown', 'Space');
    input.consumeJump();
    key('keydown', 'Space', true);
    expect(input.consumeJump()).toBe(false);
  });

  it('blends the virtual stick with the keyboard', () => {
    input.setStick(0, 1, true);
    expect(input.move.y).toBeCloseTo(1, 6);
    expect(input.running).toBe(true);
    input.setStick(0, 0, false);
    expect(input.move.y).toBe(0);
  });

  it('accumulates look deltas and clears them on read', () => {
    input.addLook(12, -5);
    input.addLook(3, 2);
    expect(input.consumeLook()).toEqual({ x: 15, y: -3 });
    expect(input.consumeLook()).toEqual({ x: 0, y: 0 });
  });

  it('releases everything on window blur', () => {
    key('keydown', 'KeyW');
    key('keydown', 'ShiftLeft');
    input.addLook(20, 20);
    window.dispatchEvent(new Event('blur'));
    expect(input.move.x).toBe(0);
    expect(input.move.y).toBe(0);
    expect(input.running).toBe(false);
    expect(input.consumeJump()).toBe(false);
    expect(input.consumeLook()).toEqual({ x: 0, y: 0 });
  });

  it('does not leave a key stuck after releaseAll', () => {
    key('keydown', 'KeyD');
    input.releaseAll();
    // The key is physically still down, but a fresh keyup must not
    // resurrect movement.
    key('keyup', 'KeyD');
    expect(input.anyMovement).toBe(false);
  });
});
