import { describe, it, expect } from 'vitest';
import {
  GamepadReader,
  applyDeadzone,
  applyTriggerDeadzone,
  STICK_DEADZONE,
  TRIGGER_DEADZONE,
  type GamepadAction,
} from '../src/core/GamepadReader';

/** A gamepad shaped like the standard mapping, with everything at rest. */
function pad(over: Partial<{
  axes: number[];
  buttons: Array<number | boolean>;
  mapping: string;
  connected: boolean;
  id: string;
}> = {}): Gamepad {
  const buttons = (over.buttons ?? []).map((b) =>
    typeof b === 'number'
      ? { pressed: b > 0.5, touched: b > 0, value: b }
      : { pressed: b, touched: b, value: b ? 1 : 0 },
  );
  // Pad out to a full standard layout so index lookups never fall off the end.
  while (buttons.length < 17) buttons.push({ pressed: false, touched: false, value: 0 });

  return {
    axes: over.axes ?? [0, 0, 0, 0],
    buttons,
    connected: over.connected ?? true,
    id: over.id ?? 'Test Pad',
    index: 0,
    mapping: (over.mapping ?? 'standard') as GamepadMappingType,
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

const reader = (...pads: Array<Gamepad | null>) => new GamepadReader(() => pads);

/** Index of an action's button in the standard mapping, for building fixtures. */
const BUTTON_INDEX: Record<GamepadAction, number> = {
  jump: 0, exitVehicle: 1, interact: 2, horn: 3,
  handbrake: 4, run: 5, pause: 9, cameraReset: 11, lights: 12, flip: 13,
  shoulderSwap: 14,
};

function withButton(action: GamepadAction, down = true): Gamepad {
  const buttons: boolean[] = new Array(17).fill(false);
  buttons[BUTTON_INDEX[action]] = down;
  return pad({ buttons });
}

describe('deadzones', () => {
  it('ignores a stick resting slightly off centre', () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual({ x: 0, y: 0 });
  });

  it('ramps from zero at the boundary rather than jumping', () => {
    // Clamping without rescaling makes the first usable input land at the
    // deadzone value, so the character lurches straight to a fifth of pace.
    const justOutside = applyDeadzone(STICK_DEADZONE + 0.001, 0);
    expect(justOutside.x).toBeGreaterThan(0);
    expect(justOutside.x).toBeLessThan(0.01);
  });

  it('reaches full deflection at full stick', () => {
    expect(applyDeadzone(1, 0).x).toBeCloseTo(1, 6);
  });

  it('is radial, not square', () => {
    // The distinguishing case: each axis is *below* the threshold, but the
    // stick is pushed 0.198 from centre — past it. A per-axis deadzone would
    // reject this and the stick would feel dead along the diagonals.
    const each = 0.14;
    expect(each).toBeLessThan(STICK_DEADZONE);
    expect(Math.hypot(each, each)).toBeGreaterThan(STICK_DEADZONE);
    expect(Math.hypot(...Object.values(applyDeadzone(each, each)))).toBeGreaterThan(0);

    // And a genuinely small diagonal is still rejected.
    expect(applyDeadzone(0.05, 0.05)).toEqual({ x: 0, y: 0 });
  });

  it('treats every direction the same at a given magnitude', () => {
    const mag = 0.5;
    const up = applyDeadzone(0, mag);
    const diag = applyDeadzone(mag * Math.SQRT1_2, mag * Math.SQRT1_2);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(Math.hypot(up.x, up.y), 6);
  });

  it('never exceeds unit length, however hard the pad reports', () => {
    const over = applyDeadzone(3, 4);
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1, 6);
  });

  it('preserves direction', () => {
    const d = applyDeadzone(-0.8, 0.6);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeGreaterThan(0);
    expect(d.y / d.x).toBeCloseTo(0.6 / -0.8, 6);
  });

  it('survives a non-finite reading', () => {
    expect(applyDeadzone(Number.NaN, 0)).toEqual({ x: 0, y: 0 });
  });

  it('deadzones triggers on their own, shorter travel', () => {
    expect(applyTriggerDeadzone(TRIGGER_DEADZONE / 2)).toBe(0);
    expect(applyTriggerDeadzone(1)).toBeCloseTo(1, 6);
    expect(applyTriggerDeadzone(Number.NaN)).toBe(0);
  });
});

describe('choosing a pad', () => {
  it('reports nothing when none is connected', () => {
    const r = reader();
    const s = r.poll();
    expect(s.connected).toBe(false);
    expect(s.move).toEqual({ x: 0, y: 0 });
  });

  it('ignores a disconnected entry', () => {
    expect(reader(null, pad({ connected: false })).poll().connected).toBe(false);
  });

  it('prefers a standard mapping over one listed earlier', () => {
    // The button table is only meaningful for standard mappings, so a
    // non-standard pad must not win just by being first.
    const r = reader(pad({ mapping: 'none', id: 'Odd' }), pad({ id: 'Proper' }));
    const s = r.poll();
    expect(s.id).toBe('Proper');
    expect(s.standard).toBe(true);
  });

  it('falls back to a non-standard pad rather than nothing', () => {
    const s = reader(pad({ mapping: 'none', id: 'Odd' })).poll();
    expect(s.connected).toBe(true);
    expect(s.standard).toBe(false);
  });
});

describe('movement axes', () => {
  it('reads stick up as forward, matching the keyboard', () => {
    // The standard mapping reports -1 for up; W is +1 forward. One convention
    // downstream, not two.
    const s = reader(pad({ axes: [0, -1, 0, 0] })).poll();
    expect(s.move.y).toBeCloseTo(1, 6);
  });

  it('reads stick down as backward', () => {
    expect(reader(pad({ axes: [0, 1, 0, 0] })).poll().move.y).toBeCloseTo(-1, 6);
  });

  it('reads right as +x, matching D', () => {
    expect(reader(pad({ axes: [1, 0, 0, 0] })).poll().move.x).toBeCloseTo(1, 6);
  });

  it('passes the right stick through for looking', () => {
    const s = reader(pad({ axes: [0, 0, 0.9, -0.5] })).poll();
    expect(s.look.x).toBeGreaterThan(0);
    expect(s.look.y).toBeLessThan(0);
  });
});

describe('driving axes', () => {
  it('steers from the left stick, left negative', () => {
    expect(reader(pad({ axes: [-1, 0, 0, 0] })).poll().steer).toBeCloseTo(-1, 6);
    expect(reader(pad({ axes: [1, 0, 0, 0] })).poll().steer).toBeCloseTo(1, 6);
  });

  it('is symmetric — full left and full right are mirror images', () => {
    const left = reader(pad({ axes: [-0.6, 0, 0, 0] })).poll().steer;
    const right = reader(pad({ axes: [0.6, 0, 0, 0] })).poll().steer;
    expect(left).toBeCloseTo(-right, 9);
  });

  it('does not widen the steering deadzone when the stick is also pushed forward', () => {
    // `move` goes through a radial deadzone, so reading steer from move.x would
    // mean holding forward quietly ate part of the steering range.
    const straightOnly = reader(pad({ axes: [0.25, 0, 0, 0] })).poll().steer;
    const alsoForward = reader(pad({ axes: [0.25, -1, 0, 0] })).poll().steer;
    expect(alsoForward).toBeCloseTo(straightOnly, 9);
  });

  it('reads analogue triggers', () => {
    const buttons: number[] = new Array(17).fill(0);
    buttons[7] = 0.5;
    buttons[6] = 1;
    const s = reader(pad({ buttons })).poll();
    expect(s.throttle).toBeGreaterThan(0.4);
    expect(s.throttle).toBeLessThan(0.6);
    expect(s.brake).toBeCloseTo(1, 6);
  });

  it('falls back to the pressed flag on pads with digital triggers', () => {
    const buttons: Array<number | boolean> = new Array(17).fill(false);
    buttons[7] = true; // pressed, but value 0
    const s = reader(pad({ buttons })).poll();
    expect(s.throttle).toBeCloseTo(1, 6);
  });

  it('rests at zero throttle and brake', () => {
    const s = reader(pad()).poll();
    expect(s.throttle).toBe(0);
    expect(s.brake).toBe(0);
  });
});

describe('buttons and edges', () => {
  it('maps each action to its own button', () => {
    for (const action of Object.keys(BUTTON_INDEX) as GamepadAction[]) {
      const s = reader(withButton(action)).poll();
      expect([...s.held]).toEqual([action]);
    }
  });

  it('fires once per press, not once per frame held', () => {
    const p = withButton('interact');
    const r = new GamepadReader(() => [p]);

    expect(r.poll().pressed.has('interact')).toBe(true);
    expect(r.poll().pressed.has('interact')).toBe(false);
    expect(r.poll().pressed.has('interact')).toBe(false);
    expect(r.current.held.has('interact')).toBe(true);
  });

  it('fires again after a release', () => {
    let down = true;
    const r = new GamepadReader(() => [withButton('jump', down)]);
    expect(r.poll().pressed.has('jump')).toBe(true);
    down = false;
    r.poll();
    down = true;
    expect(r.poll().pressed.has('jump')).toBe(true);
  });

  it('separates jump from interact, so getting into a car does not jump', () => {
    expect(BUTTON_INDEX.jump).not.toBe(BUTTON_INDEX.interact);
    const s = reader(withButton('interact')).poll();
    expect(s.held.has('jump')).toBe(false);
  });

  it('drops held buttons when the pad goes away', () => {
    let present = true;
    const r = new GamepadReader(() => (present ? [withButton('run')] : []));
    expect(r.poll().held.has('run')).toBe(true);
    present = false;
    expect(r.poll().held.size).toBe(0);
  });

  it('does not report a stale press after reset', () => {
    const p = withButton('horn');
    const r = new GamepadReader(() => [p]);
    r.poll();
    r.reset();
    expect(r.current.connected).toBe(false);
    // The button never went up, but after a reset it counts as a fresh press.
    expect(r.poll().pressed.has('horn')).toBe(true);
  });
});
