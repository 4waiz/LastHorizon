/**
 * Gamepad input.
 *
 * There was none in the repository before Phase 5 — `InputManager` read the
 * keyboard and the pointer, and the touch pad drove the same fields. Driving is
 * what forces the issue: a car wants an *analogue* steering angle and analogue
 * throttle, and a keyboard can only say "fully left" or "nothing".
 *
 * The Gamepad API is polled rather than evented, so this is a `poll()` called
 * once per frame that returns a whole state, plus edge detection so a button
 * fires once per press rather than once per frame.
 *
 * The gamepad source is injectable, because `navigator.getGamepads` cannot be
 * driven from a unit test and the interesting parts here — deadzones, sign
 * conventions, edges — are exactly the parts worth testing.
 */

/** W3C "standard" mapping. Anything else is used, but the layout may be wrong. */
export const STANDARD_MAPPING = 'standard';

export type GamepadAction =
  | 'jump'
  | 'interact'
  | 'run'
  | 'exitVehicle'
  | 'horn'
  | 'lights'
  | 'handbrake'
  | 'cameraReset'
  | 'pause';

/**
 * Button indices in the standard mapping.
 *
 * `interact` is the west face button rather than south: south is jump on foot,
 * and a player pressing A to get into a car and jumping instead is the kind of
 * thing that reads as broken rather than as a mistake.
 */
const BUTTON: Record<GamepadAction, number> = {
  jump: 0,          // A / cross
  exitVehicle: 1,   // B / circle
  interact: 2,      // X / square
  horn: 3,          // Y / triangle
  run: 5,           // right bumper
  handbrake: 4,     // left bumper
  cameraReset: 11,  // right stick click
  lights: 12,       // d-pad up
  pause: 9,         // start
};

const AXIS = { moveX: 0, moveY: 1, lookX: 2, lookY: 3 } as const;
const TRIGGER = { brake: 6, throttle: 7 } as const;

/**
 * Sticks rest slightly off centre and worn ones rest further off, so a raw
 * reading drifts. 0.18 clears every pad tested without eating usable travel.
 */
export const STICK_DEADZONE = 0.18;
/** Triggers rest at 0 but chatter; this is smaller because the travel is short. */
export const TRIGGER_DEADZONE = 0.06;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface GamepadState {
  readonly connected: boolean;
  readonly id: string;
  /** Standard mapping, so the button layout above is trustworthy. */
  readonly standard: boolean;
  /** `y` is +1 forward, matching the keyboard's W. */
  readonly move: Vec2;
  /** Right stick, -1..1. The caller scales it into look units. */
  readonly look: Vec2;
  /** -1 full left .. +1 full right. */
  readonly steer: number;
  readonly throttle: number;
  readonly brake: number;
  /** Actions whose button went down this poll. */
  readonly pressed: ReadonlySet<GamepadAction>;
  /** Actions whose button is down now. */
  readonly held: ReadonlySet<GamepadAction>;
}

export const EMPTY_STATE: GamepadState = {
  connected: false,
  id: '',
  standard: false,
  move: { x: 0, y: 0 },
  look: { x: 0, y: 0 },
  steer: 0,
  throttle: 0,
  brake: 0,
  pressed: new Set(),
  held: new Set(),
};

/**
 * Radial deadzone with rescaling.
 *
 * Two bugs avoided in one function. Deadzoning each axis separately leaves a
 * *square* dead region, so a stick pushed diagonally registers before one
 * pushed straight up. And clamping without rescaling means the first input past
 * the threshold jumps straight to `dead` — the character lurches from stationary
 * to a fifth of walking pace. Rescaling ramps from zero at the boundary.
 */
export function applyDeadzone(x: number, y: number, dead = STICK_DEADZONE): Vec2 {
  const mag = Math.hypot(x, y);
  if (!Number.isFinite(mag) || mag <= dead) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - dead) / (1 - dead));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

/** Same idea in one dimension, for triggers. */
export function applyTriggerDeadzone(v: number, dead = TRIGGER_DEADZONE): number {
  if (!Number.isFinite(v) || v <= dead) return 0;
  return Math.min(1, (v - dead) / (1 - dead));
}

export type GamepadSource = () => ReadonlyArray<Gamepad | null>;

const defaultSource: GamepadSource = () =>
  typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
    ? navigator.getGamepads()
    : [];

export class GamepadReader {
  private held = new Set<GamepadAction>();
  private state: GamepadState = EMPTY_STATE;

  constructor(private readonly source: GamepadSource = defaultSource) {}

  get current(): GamepadState {
    return this.state;
  }

  get connected(): boolean {
    return this.state.connected;
  }

  /**
   * Read every connected pad and take the first usable one.
   *
   * A standard-mapping pad is preferred over a non-standard one even if the
   * non-standard one is listed first, because the button table above is only
   * meaningful for standard mappings.
   */
  private pick(): Gamepad | null {
    let fallback: Gamepad | null = null;
    for (const pad of this.source()) {
      if (!pad || !pad.connected) continue;
      if (pad.mapping === STANDARD_MAPPING) return pad;
      fallback ??= pad;
    }
    return fallback;
  }

  poll(): GamepadState {
    const pad = this.pick();
    if (!pad) {
      this.held.clear();
      this.state = EMPTY_STATE;
      return this.state;
    }

    const axis = (i: number) => pad.axes[i] ?? 0;
    const button = (i: number) => pad.buttons[i]?.pressed ?? false;
    const analog = (i: number) => pad.buttons[i]?.value ?? 0;

    // The standard mapping reports -1 when the stick is pushed *up*, while the
    // keyboard's W is +1 forward. Negating here keeps one convention downstream
    // instead of two.
    const move = applyDeadzone(axis(AXIS.moveX), -axis(AXIS.moveY));
    const look = applyDeadzone(axis(AXIS.lookX), axis(AXIS.lookY));

    const held = new Set<GamepadAction>();
    for (const [action, index] of Object.entries(BUTTON) as [GamepadAction, number][]) {
      if (button(index)) held.add(action);
    }

    // Triggers are analogue, but some pads report them as plain buttons with no
    // value. Falling back to the pressed flag keeps those usable, fully on.
    const throttleRaw = analog(TRIGGER.throttle) || (button(TRIGGER.throttle) ? 1 : 0);
    const brakeRaw = analog(TRIGGER.brake) || (button(TRIGGER.brake) ? 1 : 0);

    const pressed = new Set<GamepadAction>();
    for (const action of held) {
      if (!this.held.has(action)) pressed.add(action);
    }
    this.held = held;

    this.state = {
      connected: true,
      id: pad.id ?? '',
      standard: pad.mapping === STANDARD_MAPPING,
      move,
      look,
      // Steering reads the raw stick with its own deadzone rather than `move.x`:
      // `move` has been through a *radial* deadzone, so pushing forward on the
      // throttle stick would quietly widen the steering dead region.
      steer: applyDeadzone(axis(AXIS.moveX), 0).x,
      throttle: applyTriggerDeadzone(throttleRaw),
      brake: applyTriggerDeadzone(brakeRaw),
      pressed,
      held,
    };
    return this.state;
  }

  /** Forget held buttons, so a release that happened while blurred is not missed. */
  reset(): void {
    this.held.clear();
    this.state = EMPTY_STATE;
  }
}
