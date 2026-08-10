/**
 * Keyboard, mouse, wheel, touch and gamepad input.
 *
 * The manager only records *state*; it never touches the scene. That keeps it
 * unit-testable and means a lost window focus can be handled in one place
 * (`releaseAll`) rather than leaving a key stuck down.
 *
 * Every device feeds the same fields. A player can pick a controller up or put
 * it down mid-session and nothing has to be switched over.
 */

import { GamepadReader, type GamepadState, EMPTY_STATE } from './GamepadReader';

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

/**
 * Right stick sweep at full deflection, in look-units per second.
 *
 * The look field is a pointer-drag delta in pixels, so a stick has to be
 * converted into the same currency rather than given its own path -- otherwise
 * the camera would need to know which device moved it.
 */
const GAMEPAD_LOOK_RATE = 620;

export class InputManager {
  readonly move: MoveAxis = { x: 0, y: 0 };
  /** Camera orbit delta accumulated since the last `consumeLook()`. */
  private lookX = 0;
  private lookY = 0;
  private zoomDelta = 0;

  private keys = new Set<string>();
  private jumpQueued = false;
  /** True once per press of the righting key. */
  private flipQueued = false;
  /** True once per press of the map key. */
  private mapQueued = false;
  private journalQueued = false;
  private interactQueued = false;
  /** Touch or gamepad interact, which have no entry in `keys`. */
  private pointerInteractHeld = false;
  private pointerActive = false;
  private pointerId = -1;
  private lastPointer = { x: 0, y: 0 };

  // -- Phase 9: combat -----------------------------------------------------
  //
  // Mouse buttons rather than keys, because the camera is drag-to-look and
  // aiming while looking is one gesture. Right holds the aim, left pulls the
  // trigger, and both still drag — which is what you want. `R` was already
  // taken by vehicle righting since Phase 5, so reload is `G`.
  private mouseAim = false;
  private syntheticAim = false;
  private mouseFire = false;
  private drawQueued = false;
  private reloadQueued = false;
  private shoulderQueued = false;
  /** 0-based weapon slot from the number row, or -1. */
  private slotQueued = -1;

  /** Virtual joystick state, driven by the on-screen pad. */
  private stick: MoveAxis = { x: 0, y: 0 };
  private stickRunning = false;

  /**
   * Gamepad, polled rather than evented.
   *
   * Kept as its own contributor to `move` alongside the keyboard and the touch
   * stick, so a player can put a controller down mid-session and keep playing
   * on the keyboard without anything having to be switched over.
   */
  private readonly gamepad = new GamepadReader();
  private gamepadMove: MoveAxis = { x: 0, y: 0 };
  private gamepadRunning = false;
  private gamepadInteractHeld = false;
  private gamepadState: GamepadState = EMPTY_STATE;

  private disposers: Array<() => void> = [];
  private element: HTMLElement | null = null;

  get running(): boolean {
    return (
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.stickRunning ||
      this.gamepadRunning
    );
  }

  /** Last polled pad state, for the vehicle controller's analogue axes. */
  get pad(): GamepadState {
    return this.gamepadState;
  }

  get gamepadConnected(): boolean {
    return this.gamepadState.connected;
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
      if (code === 'KeyE' || code === 'KeyF' || code === 'Enter') {
        this.interactQueued = true;
        e.preventDefault();
      }
      if (code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
      // Righting a vehicle. Harmless on foot, so it needs no mode check here.
      if (code === 'KeyR') {
        this.flipQueued = true;
        e.preventDefault();
      }
      if (code === 'KeyM') {
        this.mapQueued = true;
        e.preventDefault();
      }
      if (code === 'KeyJ') {
        this.journalQueued = true;
        e.preventDefault();
      }
      if (code === 'KeyQ') {
        this.drawQueued = true;
        e.preventDefault();
      }
      if (code === 'KeyG') {
        this.reloadQueued = true;
        e.preventDefault();
      }
      if (code === 'KeyV') {
        this.shoulderQueued = true;
        e.preventDefault();
      }
      if (code.startsWith('Digit')) {
        const n = Number(code.slice(5));
        if (n >= 1 && n <= 4) {
          this.slotQueued = n - 1;
          e.preventDefault();
        }
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
    this.move.x = x + this.stick.x + this.gamepadMove.x;
    this.move.y = y + this.stick.y + this.gamepadMove.y;
    const l2 = Math.hypot(this.move.x, this.move.y);
    if (l2 > 1) {
      this.move.x /= l2;
      this.move.y /= l2;
    }
  }

  /**
   * Poll the gamepad and fold it into the shared input state.
   *
   * Called once per frame, because the Gamepad API has no events for axis
   * movement -- a pad that is never polled reports nothing at all.
   */
  pollGamepad(dt: number): GamepadState {
    const s = this.gamepad.poll();
    this.gamepadState = s;

    if (!s.connected) {
      if (this.gamepadMove.x !== 0 || this.gamepadMove.y !== 0) {
        this.gamepadMove.x = 0;
        this.gamepadMove.y = 0;
        this.recomputeMove();
      }
      this.gamepadRunning = false;
      this.gamepadInteractHeld = false;
      return s;
    }

    this.gamepadMove.x = s.move.x;
    this.gamepadMove.y = s.move.y;
    this.gamepadRunning = s.held.has('run');
    this.recomputeMove();

    // Look is a pointer-drag delta in pixels; a stick deflection is a rate, so
    // it has to be integrated over the frame to land in the same units.
    if (Number.isFinite(dt) && dt > 0) {
      this.lookX += s.look.x * GAMEPAD_LOOK_RATE * dt;
      this.lookY += s.look.y * GAMEPAD_LOOK_RATE * dt;
    }

    if (s.pressed.has('jump')) this.jumpQueued = true;
    if (s.pressed.has('flip')) this.flipQueued = true;

    // Held, not just pressed: hold-to-act needs a release to end it, and the
    // pad is the one device that can report both cleanly.
    const interact = s.held.has('interact');
    if (interact !== this.gamepadInteractHeld) {
      this.gamepadInteractHeld = interact;
      if (interact) this.interactQueued = true;
    }

    return s;
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

  queueInteract(): void {
    this.interactQueued = true;
  }

  /**
   * True while an interact control is down, for hold-to-act actions.
   *
   * The keyboard already tracks this in `keys`; touch and gamepad only produce
   * edges, so they report through `setInteractHeld`.
   */
  get interactHeld(): boolean {
    return (
      this.pointerInteractHeld ||
      this.gamepadInteractHeld ||
      this.keys.has('KeyE') ||
      this.keys.has('KeyF') ||
      this.keys.has('Enter')
    );
  }

  /** Press and release from a control with no key state of its own. */
  setInteractHeld(down: boolean): void {
    this.pointerInteractHeld = down;
    if (down) this.interactQueued = true;
  }

  /** True exactly once per interact press. */
  consumeInteract(): boolean {
    if (!this.interactQueued) return false;
    this.interactQueued = false;
    return true;
  }

  /** True exactly once per press of R, or the pad's righting button. */
  consumeFlip(): boolean {
    if (!this.flipQueued) return false;
    this.flipQueued = false;
    return true;
  }

  queueFlip(): void {
    this.flipQueued = true;
  }

  /** True exactly once per press of M. */
  consumeMap(): boolean {
    if (!this.mapQueued) return false;
    this.mapQueued = false;
    return true;
  }

  /**
   * J, for the story journal.
   *
   * Queued and consumed like the map rather than read as a held key: both open
   * a panel, and a panel that toggles once per frame while the key is down is
   * a panel that flickers.
   */
  consumeJournal(): boolean {
    if (!this.journalQueued) return false;
    this.journalQueued = false;
    return true;
  }

  // -- Phase 9: combat -----------------------------------------------------

  /**
   * Aim, held.
   *
   * Right mouse or the pad's left trigger. The trigger is free on foot — it is
   * the brake, and there is nothing to brake — so the standard console mapping
   * costs nothing.
   */
  get aimHeld(): boolean {
    return this.mouseAim || this.syntheticAim || this.gamepadState.brake > 0.5;
  }

  /**
   * Hold or release aim from something that is not a mouse.
   *
   * Aiming is a *held* state, and the frame loop rebuilds it from input every
   * tick — so a test that set it on the weapon system directly had it wiped one
   * frame later and could never see the camera move. This is the same shape as
   * `setInteractHeld`: the synthetic source joins the real ones rather than
   * writing past them.
   */
  setAimHeld(down: boolean): void {
    this.syntheticAim = down;
  }

  /** Trigger, held. Left mouse or the pad's right trigger. */
  get fireHeld(): boolean {
    return this.mouseFire || this.gamepadState.throttle > 0.5;
  }

  /** True once per press of Q. Draws or puts away. */
  consumeDraw(): boolean {
    if (!this.drawQueued) return false;
    this.drawQueued = false;
    return true;
  }

  /** True once per press of G. */
  consumeReload(): boolean {
    if (!this.reloadQueued) return false;
    this.reloadQueued = false;
    return true;
  }

  /**
   * True once per press of V, or of the pad's right stick.
   *
   * The stick click is the standard console mapping for this and, unlike the
   * triggers, it is free on foot *and* while driving — so it does not need the
   * `aimHeld` guard the rest of the combat bindings live behind.
   */
  consumeShoulderSwap(): boolean {
    const pressed = this.shoulderQueued || this.gamepadState.pressed.has('shoulderSwap');
    this.shoulderQueued = false;
    return pressed;
  }

  /** 0-based weapon slot from the number row, or -1 if none was pressed. */
  consumeWeaponSlot(): number {
    const n = this.slotQueued;
    this.slotQueued = -1;
    return n;
  }

  queueMap(): void {
    this.mapQueued = true;
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
    if (e.button === 2) this.mouseAim = true;
    if (e.button === 0) this.mouseFire = true;
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
    // Buttons are released whatever pointer they belong to. A drag that starts
    // on the canvas and ends over a panel still has to let go of the trigger.
    if (e.button === 2) this.mouseAim = false;
    if (e.button === 0) this.mouseFire = false;
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
    this.flipQueued = false;
    this.mapQueued = false;
    this.interactQueued = false;
    // A held trigger that was released while the tab was hidden was never
    // seen, so an unreleased mouse button would keep firing on return.
    this.mouseAim = false;
    this.syntheticAim = false;
    this.mouseFire = false;
    this.drawQueued = false;
    this.reloadQueued = false;
    this.shoulderQueued = false;
    this.slotQueued = -1;
    this.pointerInteractHeld = false;
    this.gamepadInteractHeld = false;
    this.gamepadRunning = false;
    this.gamepadMove.x = 0;
    this.gamepadMove.y = 0;
    // Forget held buttons: a release that happened while blurred was missed,
    // and without this the next poll would see a button that never went up.
    this.gamepad.reset();
    this.move.x = 0;
    this.move.y = 0;
    this.lookX = 0;
    this.lookY = 0;
  }
}
