import { describe, it, expect } from 'vitest';
import { EMPTY_STATE, type GamepadAction, type GamepadState } from '../src/core/GamepadReader';
import { BICYCLE, HATCHBACK, POLICE, VAN } from '../src/vehicles/VehicleDefinition';
import {
  cameraYawFor, dashboard, isReversing, vehicleCameraTuning, vehicleInputFrom,
} from '../src/vehicles/VehicleControls';

const pad = (over: Partial<GamepadState> = {}): GamepadState => ({
  ...EMPTY_STATE,
  connected: true,
  held: new Set<GamepadAction>(),
  pressed: new Set<GamepadAction>(),
  ...over,
});

const noPad = EMPTY_STATE;
const stick = (x: number, y: number) => ({ x, y });

describe('keyboard and touch', () => {
  it('drives forward from a forward stick', () => {
    const i = vehicleInputFrom(stick(0, 1), noPad, false);
    expect(i.throttle).toBe(1);
    expect(i.brake).toBe(0);
  });

  it('brakes from a backward stick', () => {
    const i = vehicleInputFrom(stick(0, -1), noPad, false);
    expect(i.brake).toBe(1);
    expect(i.throttle).toBe(0);
  });

  it('steers from the sideways axis', () => {
    expect(vehicleInputFrom(stick(1, 0), noPad, false).steer).toBe(1);
    expect(vehicleInputFrom(stick(-1, 0), noPad, false).steer).toBe(-1);
  });

  it('never presses both pedals from one stick', () => {
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      const i = vehicleInputFrom(stick(0, y), noPad, false);
      expect(Math.min(i.throttle, i.brake)).toBe(0);
    }
  });

  it('passes the handbrake through', () => {
    expect(vehicleInputFrom(stick(0, 0), noPad, true).handbrake).toBe(true);
  });
});

describe('a gamepad takes over per axis, not wholesale', () => {
  it('prefers the trigger when it is actually pressed', () => {
    const i = vehicleInputFrom(stick(0, 0), pad({ throttle: 0.6 }), false);
    expect(i.throttle).toBeCloseTo(0.6, 6);
  });

  it('leaves the keyboard in charge of an axis the pad is not touching', () => {
    // A pad plugged in but idle must not stop the keyboard working -- this is
    // the case that a "pad is connected, pad wins" rule gets wrong.
    const i = vehicleInputFrom(stick(0, 1), pad(), false);
    expect(i.throttle).toBe(1);
  });

  it('mixes devices on different axes', () => {
    const i = vehicleInputFrom(stick(0, 1), pad({ steer: 0.5 }), false);
    expect(i.steer).toBeCloseTo(0.5, 6);
    expect(i.throttle).toBe(1);
  });

  it('ignores a stick resting fractionally off centre', () => {
    const i = vehicleInputFrom(stick(0.9, 0), pad({ steer: 0.005 }), false);
    expect(i.steer).toBeCloseTo(0.9, 6);
  });

  it('falls back to the stick on a pad with dead triggers', () => {
    const i = vehicleInputFrom(stick(0, 1), pad({ throttle: 0, brake: 0 }), false);
    expect(i.throttle).toBe(1);
  });

  it('reads the handbrake off the pad', () => {
    const held = new Set<GamepadAction>(['handbrake']);
    expect(vehicleInputFrom(stick(0, 0), pad({ held }), false).handbrake).toBe(true);
  });

  it('ignores a disconnected pad entirely', () => {
    const ghost = { ...EMPTY_STATE, steer: 1, throttle: 1 } as GamepadState;
    const i = vehicleInputFrom(stick(0, 0), ghost, false);
    expect(i.steer).toBe(0);
    expect(i.throttle).toBe(0);
  });

  it('always produces a valid input', () => {
    const nonsense = { ...EMPTY_STATE, connected: true, steer: Number.NaN, throttle: 9 } as GamepadState;
    const i = vehicleInputFrom(stick(Number.NaN, 5), nonsense, false);
    expect(Number.isFinite(i.steer)).toBe(true);
    expect(i.throttle).toBeGreaterThanOrEqual(0);
    expect(i.throttle).toBeLessThanOrEqual(1);
  });
});

describe('camera', () => {
  it('sits further back the faster the vehicle goes', () => {
    const parked = vehicleCameraTuning(HATCHBACK.camera, 0, HATCHBACK.drive.maxSpeed);
    const fast = vehicleCameraTuning(HATCHBACK.camera, HATCHBACK.drive.maxSpeed, HATCHBACK.drive.maxSpeed);
    expect(fast.distance).toBeGreaterThan(parked.distance);
  });

  it('raises its own floor at speed, so a near miss is not a screenful of paint', () => {
    const parked = vehicleCameraTuning(HATCHBACK.camera, 0, HATCHBACK.drive.maxSpeed);
    const fast = vehicleCameraTuning(HATCHBACK.camera, HATCHBACK.drive.maxSpeed, HATCHBACK.drive.maxSpeed);
    expect(fast.minDistance).toBeGreaterThan(parked.minDistance);
    expect(fast.minDistance).toBeLessThan(fast.distance);
  });

  it('drops the shoulder offset, which would put it inside the bodywork', () => {
    expect(vehicleCameraTuning(VAN.camera, 0, VAN.drive.maxSpeed).shoulderOffset).toBe(0);
  });

  it('sits further back for a van than a hatchback', () => {
    const van = vehicleCameraTuning(VAN.camera, 0, VAN.drive.maxSpeed);
    const car = vehicleCameraTuning(HATCHBACK.camera, 0, HATCHBACK.drive.maxSpeed);
    expect(van.distance).toBeGreaterThan(car.distance);
    expect(van.height).toBeGreaterThan(car.height);
  });

  it('is unfazed by an absurd speed', () => {
    const t = vehicleCameraTuning(HATCHBACK.camera, 1e6, HATCHBACK.drive.maxSpeed);
    expect(Number.isFinite(t.distance)).toBe(true);
    expect(t.distance).toBeLessThan(HATCHBACK.camera.distance + HATCHBACK.camera.speedPullback + 1e-6);
  });

  it('swings round partway when reversing, not a full flip', () => {
    const heading = 0.5;
    const forward = cameraYawFor(heading, HATCHBACK.camera, false);
    const back = cameraYawFor(heading, HATCHBACK.camera, true);
    expect(forward).toBeCloseTo(heading, 9);
    expect(back).not.toBeCloseTo(heading, 3);
    // A full 180 would hide where the nose is pointing.
    expect(Math.abs(back - heading)).toBeLessThan(Math.PI);
  });
});

describe('reverse detection has hysteresis', () => {
  it('does not call a gentle roll-back reversing', () => {
    expect(isReversing(-0.5, false)).toBe(false);
  });

  it('engages once genuinely reversing', () => {
    expect(isReversing(-2, false)).toBe(true);
  });

  it('holds on through the slow part rather than flickering', () => {
    // Coming to a stop from reverse crosses -1.2; without hysteresis the
    // camera would swing back and forth around that speed.
    expect(isReversing(-0.6, true)).toBe(true);
    expect(isReversing(0.5, true)).toBe(false);
  });
});

describe('dashboard', () => {
  it('shows a rounded speed in km/h', () => {
    expect(dashboard(HATCHBACK, 42.4, 'D', 1, 1).speed).toBe('42 km/h');
  });

  it('never shows a negative speed while reversing', () => {
    expect(dashboard(HATCHBACK, -20, 'R', 1, 1).speed).toBe('0 km/h');
  });

  it('reports no fuel gauge for the bicycle', () => {
    expect(dashboard(BICYCLE, 10, 'D', 1, null).fuel).toBeNull();
  });

  it('reports a fuel gauge for anything with a tank', () => {
    expect(dashboard(POLICE, 10, 'D', 1, 0.5).fuel).toBeCloseTo(0.5, 6);
  });

  it('clamps condition into a bar', () => {
    expect(dashboard(VAN, 0, 'N', 5, 1).condition).toBe(1);
    expect(dashboard(VAN, 0, 'N', -2, 1).condition).toBe(0);
  });

  it('always offers a way out', () => {
    for (const def of [BICYCLE, HATCHBACK, VAN, POLICE]) {
      expect(dashboard(def, 0, 'N', 1, 1).hints).toContain('Exit');
    }
  });

  it('always shows how to right the vehicle', () => {
    // Shown even when upright: a player on their roof should not have to go
    // looking for the control that fixes it.
    for (const def of [BICYCLE, HATCHBACK, VAN, POLICE]) {
      expect(dashboard(def, 0, 'N', 1, 1).hints.join(' ')).toContain('right it');
    }
  });
});
