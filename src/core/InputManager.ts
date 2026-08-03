/**
 * Keyboard, mouse, wheel and touch input.
 *
 * The manager only records *state*; it never touches the scene. That keeps it
 * unit-testable and means a lost window focus can be handled in one place
 * (`releaseAll`) rather than leaving a key stuck down.
 */

export interface MoveAxis {
  x: number;
  y: number;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class InputManager {
  readonly move: MoveAxis = { x: 0, y: 0 };
  /** Camera orbit delta accumulated since the last `consumeLook()`. */
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;

  private keys = new Set<string>();
  private jumpQueued = false;
  private pointerActive = false;
  private pointerId = -1;
  private lastPointer = { x: 0, y: 0 };

  /** Virtual joystick state, driven by the on-screen pad. */
  private stick: MoveAxis = { x: 0, y: 0 };
  private stickRunning = false;

  private disposers: Array<() => void> = [];
  private element: HTMLElement | null = null;

  get running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.stickRunning;
  }

  get anyMovement(): boolean {
    return Math.abs(this.move.x) > 0.001 || Math.abs(this.move.y) > 0.001;
  }

  attach(element: HTMLElement): void {
    this.element = element;
    const win = window;

    const on = <K extends keyof WindowEventMap>(
      target: EventTarget,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(win, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    on(win, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    on(win, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    on(element, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
    on(win, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    on(win, 'pointerup', (e: PointerEvent) => this.onPointerUp(e));
    on(win, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e));
    on(element, 'contextmenu', (e: Event) => e.preventDefault());
    on(element, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.releaseAll();
    this.element = null;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    const code = e.code;
    if (down) {
      if (code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
      if (code in MOVE_KEYS || code === 'Space') e.preventDefault();
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
    this.recomputeMove();
  }

  private recomputeMove(): void {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    // Keyboard input is a unit square; normalise so diagonals aren't faster.
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x + this.stick.x;
    this.move.y = y + this.stick.y;
    const l2 = Math.hypot(this.move.x, this.move.y);
    if (l2 > 1) {
      this.move.x /= l2;
      this.move.y /= l2;
    }
  }

  /** Called by the on-screen joystick. Components are already in [-1,1]. */
  setStick(x: number, y: number, running = false): void {
    this.stick.x = x;
    this.stick.y = y;
    this.stickRunning = running;
    this.recomputeMove();
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  /** True exactly once per jump press. */
  consumeJump(): boolean {
    if (!this.jumpQueued) return false;
    this.jumpQueued = false;
    return true;
  }

  private onPointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement)?.closest?.('[data-ui]')) return;
    if (e.pointerType === 'touch') return; // touch look is handled by the HUD pad
    this.pointerActive = true;
    this.pointerId = e.pointerId;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
    this.element?.setPointerCapture?.(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointerActive || e.pointerId !== this.pointerId) return;
    this.lookX += e.clientX - this.lastPointer.x;
    this.lookY += e.clientY - this.lastPointer.y;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerActive = false;
    this.pointerId = -1;
  }

  /** Used by the touch look-pad. */
  addLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Trackpads emit many small deltas; clamp so a flick doesn't jump the zoom.
    this.zoomDelta += Math.max(-40, Math.min(40, e.deltaY)) * 0.01;
  }

  consumeLook(): { x: number; y: number } {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  consumeZoom(): number {
    const z = this.zoomDelta;
    this.zoomDelta = 0;
    return z;
  }

  /** Drop every held key/pointer — used on blur so nothing sticks. */
  releaseAll(): void {
    this.keys.clear();
    this.stick.x = 0;
    this.stick.y = 0;
    this.stickRunning = false;
    this.pointerActive = false;
    this.pointerId = -1;
    this.jumpQueued = false;
    this.move.x = 0;
    this.move.y = 0;
    this.lookX = 0;
    this.lookY = 0;
  }
}
